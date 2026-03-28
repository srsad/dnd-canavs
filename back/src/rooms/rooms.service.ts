import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from 'nestjs-prisma';
import { AuthenticatedRequestUser } from '../auth/auth.types';
import {
  CanvasToken,
  CanvasStroke,
  CanvasStrokePoint,
  ChatMessage,
  DiceRollLog,
  RoomCanvasState,
  ParticipantPresence,
  RoomParticipant,
  RoomParticipantWithPresence,
  RoomRecord,
  RoomSession,
} from './rooms.types';

@Injectable()
export class RoomsService {
  private readonly sessions = new Map<string, RoomSession>();

  /** Sockets to disconnect after HTTP replaced their session (evict). */
  private readonly staleSocketsToKick: Array<{
    socketId: string;
    roomSlug: string;
  }> = [];

  private readonly sessionTtlMs =
    (Number(process.env.SESSION_TTL_MINUTES) > 0
      ? Number(process.env.SESSION_TTL_MINUTES)
      : 30) *
    60 *
    1000;

  constructor(private readonly prisma: PrismaService) {}

  async createRoom(input: {
    title: string;
    user?: AuthenticatedRequestUser;
    guestName?: string;
    guestKey?: string;
  }) {
    let hostSecretPlain: string | undefined;
    let hostSecretHash: string | null = null;

    const creator = input.user
      ? this.resolveRegisteredParticipant(input.user, 'gm')
      : (() => {
          hostSecretPlain = randomBytes(32).toString('hex');
          hostSecretHash = this.hashHostSecret(hostSecretPlain);
          return this.resolveGuestParticipant(
            input.guestName,
            input.guestKey,
            'gm',
          );
        })();

    const slug = this.createSlug();

    const room: RoomRecord = {
      id: randomUUID(),
      slug,
      title: input.title.trim(),
      createdAt: new Date().toISOString(),
      createdBy: creator,
      canvas: this.createDefaultCanvas(),
      diceLogs: [],
      canvasHistory: [],
      chatMessages: [],
      hostSecretHash,
    };

    await this.prisma.room.create({
      data: {
        id: room.id,
        slug: room.slug,
        title: room.title,
        createdAt: new Date(room.createdAt),
        createdBy: room.createdBy as unknown as object,
        canvas: room.canvas as unknown as object,
        diceLogs: room.diceLogs as unknown as object,
        canvasHistory: room.canvasHistory as unknown as object,
        chatMessages: room.chatMessages as unknown as object,
        hostSecretHash,
      },
    });

    const session = this.createSession(slug, creator);
    this.evictOtherSessionsForRoomParticipant(
      slug,
      creator.id,
      session.sessionId,
    );

    return {
      room: this.serializeRoom(room),
      participant: creator,
      sessionId: session.sessionId,
      guestKey:
        creator.kind === 'guest' ? creator.id.replace(/^guest:/, '') : undefined,
      hostSecret: hostSecretPlain,
    };
  }

  async getRoomBySlug(slug: string) {
    const room = await this.findRoomOrThrow(slug);

    return {
      room: this.serializeRoom(room),
      participants: this.listParticipants(slug, room.createdBy),
    };
  }

  async joinRoom(input: {
    slug: string;
    user?: AuthenticatedRequestUser;
    guestName?: string;
    guestKey?: string;
    hostSecret?: string;
  }) {
    const room = await this.findRoomOrThrow(input.slug);
    const secret = input.hostSecret?.trim();

    if (!input.user && secret && room.hostSecretHash) {
      if (!this.verifyHostSecret(secret, room.hostSecretHash)) {
        throw new BadRequestException('Invalid host secret.');
      }
      if (room.createdBy.kind !== 'guest') {
        throw new BadRequestException('Host secret is not valid for this room.');
      }
      const participant: RoomParticipant = { ...room.createdBy };
      const session = this.createSession(input.slug, participant);
      this.evictOtherSessionsForRoomParticipant(
        input.slug,
        participant.id,
        session.sessionId,
      );

      return {
        room: this.serializeRoom(room),
        participant,
        sessionId: session.sessionId,
        participants: this.listParticipants(input.slug, room.createdBy),
        guestKey: participant.id.replace(/^guest:/, ''),
      };
    }

    if (secret && !room.hostSecretHash) {
      throw new BadRequestException('Invalid host secret.');
    }

    let participant: RoomParticipant;

    if (input.user) {
      const ownerUserId = `user:${input.user.id}`;
      const isRegisteredOwner =
        room.createdBy.kind === 'registered' &&
        room.createdBy.id === ownerUserId;
      participant = isRegisteredOwner
        ? { ...room.createdBy }
        : this.resolveRegisteredParticipant(input.user, 'player');
    } else {
      participant = this.resolveGuestParticipant(
        input.guestName,
        input.guestKey,
        'player',
      );
    }

    const session = this.createSession(input.slug, participant);

    if (participant.id === room.createdBy.id) {
      this.evictOtherSessionsForRoomParticipant(
        input.slug,
        participant.id,
        session.sessionId,
      );
    }

    return {
      room: this.serializeRoom(room),
      participant,
      sessionId: session.sessionId,
      participants: this.listParticipants(input.slug, room.createdBy),
      guestKey:
        participant.kind === 'guest'
          ? participant.id.replace(/^guest:/, '')
          : undefined,
    };
  }

  async replaceCanvas(
    slug: string,
    canvas: RoomCanvasState,
  ): Promise<RoomCanvasState> {
    const room = await this.findRoomOrThrow(slug);

    const normalized = this.normalizeCanvas(canvas);

    const history = [...(room.canvasHistory ?? []), room.canvas];
    const limitedHistory = history.slice(-50);

    await this.prisma.room.update({
      where: { slug },
      data: {
        canvas: normalized as unknown as object,
        canvasHistory: limitedHistory as unknown as object,
      },
    });

    return normalized;
  }

  /**
   * Updates token positions without appending `canvasHistory` (unlike full `canvas:replace`).
   * Players may only move tokens assigned to them via `controlledByParticipantId`.
   */
  async applyTokenMoves(
    slug: string,
    participant: RoomParticipant,
    moves: Array<{ id: string; x: number; y: number }>,
  ): Promise<RoomCanvasState> {
    if (!Array.isArray(moves) || moves.length === 0) {
      const room = await this.findRoomOrThrow(slug);
      return this.normalizeCanvas(room.canvas as unknown as RoomCanvasState);
    }

    const room = await this.findRoomOrThrow(slug);
    const canvas = this.normalizeCanvas(room.canvas as unknown as RoomCanvasState);
    const isGm = participant.role === 'gm';

    const allowed = new Map<string, { x: number; y: number }>();
    for (const raw of moves) {
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) continue;
      const token = canvas.tokens.find((t) => t.id === id);
      if (!token) continue;
      if (isGm) {
        allowed.set(id, {
          x: Number(raw.x) || 0,
          y: Number(raw.y) || 0,
        });
        continue;
      }
      if (token.controlledByParticipantId === participant.id) {
        allowed.set(id, {
          x: Number(raw.x) || 0,
          y: Number(raw.y) || 0,
        });
      }
    }

    if (allowed.size === 0) {
      return canvas;
    }

    const nextTokens = canvas.tokens.map((token) => {
      const pos = allowed.get(token.id);
      if (!pos) return token;
      return { ...token, x: pos.x, y: pos.y };
    });

    const nextCanvas: RoomCanvasState = { ...canvas, tokens: nextTokens };

    await this.prisma.room.update({
      where: { slug },
      data: {
        canvas: nextCanvas as unknown as object,
      },
    });

    return nextCanvas;
  }

  async validateSession(sessionId: string, roomSlug: string) {
    this.pruneStaleSessions();

    const session = this.sessions.get(sessionId);

    if (!session || session.roomSlug !== roomSlug) {
      throw new NotFoundException('Session not found.');
    }

    if (!this.isSessionWithinGrace(session)) {
      this.sessions.delete(sessionId);
      throw new NotFoundException('Session not found.');
    }

    session.lastSeenAt = new Date().toISOString();

    const room = await this.findRoomOrThrow(roomSlug);

    return {
      session,
      room,
    };
  }

  async getCanvasHistory(slug: string): Promise<RoomCanvasState[]> {
    const room = await this.findRoomOrThrow(slug);
    return room.canvasHistory ?? [];
  }

  takeStaleSocketsToKick(): Array<{ socketId: string; roomSlug: string }> {
    const out = [...this.staleSocketsToKick];
    this.staleSocketsToKick.length = 0;
    return out;
  }

  /** One GM session per room: remove older sessions (and queue their sockets for kick). */
  private evictOtherSessionsForRoomParticipant(
    roomSlug: string,
    participantId: string,
    keepSessionId: string,
  ) {
    for (const [id, sess] of this.sessions) {
      if (id === keepSessionId) {
        continue;
      }
      if (sess.roomSlug === roomSlug && sess.participant.id === participantId) {
        if (sess.socketId) {
          this.staleSocketsToKick.push({
            socketId: sess.socketId,
            roomSlug: sess.roomSlug,
          });
        }
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Marks the session offline only if this disconnect belongs to the socket
   * currently bound to the session. Ignores stale disconnects from a previous
   * socket we already replaced (e.g. forced disconnect on reconnect / second tab).
   *
   * @returns whether presence actually changed
   */
  markSocketDisconnected(sessionId: string, disconnectingSocketId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (
      session.socketId !== undefined &&
      session.socketId !== disconnectingSocketId
    ) {
      return false;
    }
    session.connected = false;
    session.disconnectedAt = new Date().toISOString();
    session.socketId = undefined;
    return true;
  }

  /**
   * @returns previous socket id if it should be disconnected (another tab took over)
   */
  markSocketConnected(sessionId: string, socketId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    const previous =
      session.socketId !== undefined && session.socketId !== socketId
        ? session.socketId
        : undefined;
    session.socketId = socketId;
    session.connected = true;
    session.disconnectedAt = undefined;
    session.lastSeenAt = new Date().toISOString();
    return previous;
  }

  updateSessionClientPresence(
    sessionId: string,
    state: 'active' | 'away',
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.connected) {
      return;
    }
    session.clientUiPresence = state;
  }

  listParticipants(
    roomSlug: string,
    owner?: RoomParticipant,
  ): RoomParticipantWithPresence[] {
    this.pruneStaleSessions();

    const sessionsHere = [...this.sessions.values()].filter(
      (s) => s.roomSlug === roomSlug && this.isSessionWithinGrace(s),
    );

    const presenceRank = (p: ParticipantPresence) =>
      p === 'online' ? 2 : p === 'away' ? 1 : 0;

    const presenceByParticipantId = new Map<string, ParticipantPresence>();

    for (const s of sessionsHere) {
      const next = this.sessionToPresence(s);
      const prev = presenceByParticipantId.get(s.participant.id);
      if (prev === undefined || presenceRank(next) > presenceRank(prev)) {
        presenceByParticipantId.set(s.participant.id, next);
      }
    }

    const result: RoomParticipantWithPresence[] = [];
    const seen = new Set<string>();

    if (owner) {
      result.push({
        ...owner,
        presence: presenceByParticipantId.get(owner.id) ?? 'offline',
      });
      seen.add(owner.id);
    }

    for (const s of sessionsHere) {
      if (seen.has(s.participant.id)) {
        continue;
      }
      seen.add(s.participant.id);
      result.push({
        ...s.participant,
        presence:
          presenceByParticipantId.get(s.participant.id) ?? 'offline',
      });
    }

    return result;
  }

  private pruneStaleSessions() {
    for (const [id, session] of this.sessions) {
      if (!this.isSessionWithinGrace(session)) {
        this.sessions.delete(id);
      }
    }
  }

  private isSessionWithinGrace(session: RoomSession): boolean {
    if (session.connected) {
      return true;
    }
    const ref = session.disconnectedAt ?? session.createdAt;
    return Date.now() - new Date(ref).getTime() <= this.sessionTtlMs;
  }

  private sessionToPresence(session: RoomSession): ParticipantPresence {
    if (!session.connected) {
      return 'offline';
    }
    return session.clientUiPresence === 'away' ? 'away' : 'online';
  }

  private hashHostSecret(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  private verifyHostSecret(secret: string, storedHash: string): boolean {
    const computed = createHash('sha256').update(secret, 'utf8').digest('hex');
    try {
      const a = Buffer.from(computed, 'hex');
      const b = Buffer.from(storedHash, 'hex');
      if (a.length !== b.length) {
        return false;
      }
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private async findRoomOrThrow(slug: string): Promise<RoomRecord> {
    const dbRoom = await this.prisma.room.findUnique({
      where: { slug },
    });

    if (!dbRoom) {
      throw new NotFoundException('Room not found.');
    }

    const room: RoomRecord = {
      id: dbRoom.id,
      slug: dbRoom.slug,
      title: dbRoom.title,
      createdAt: dbRoom.createdAt.toISOString(),
      createdBy: dbRoom.createdBy as unknown as RoomParticipant,
      canvas: this.normalizeCanvas(dbRoom.canvas as unknown as RoomCanvasState),
      diceLogs: (dbRoom.diceLogs as unknown as DiceRollLog[]) ?? [],
      canvasHistory: (dbRoom.canvasHistory as unknown as RoomCanvasState[]) ?? [],
      chatMessages: (dbRoom.chatMessages as unknown as ChatMessage[]) ?? [],
      hostSecretHash: dbRoom.hostSecretHash,
    };

    return room;
  }

  private serializeRoom(room: RoomRecord) {
    return {
      id: room.id,
      slug: room.slug,
      title: room.title,
      createdAt: room.createdAt,
      createdBy: room.createdBy,
      canvas: room.canvas,
      diceLogs: room.diceLogs ?? [],
      canvasHistory: room.canvasHistory ?? [],
      chatMessages: room.chatMessages ?? [],
    };
  }

  async addDiceRoll(
    roomSlug: string,
    participant: RoomParticipant,
    diceType: string,
    count: number,
  ): Promise<DiceRollLog> {
    const room = await this.findRoomOrThrow(roomSlug);

    const sides = this.parseDiceSides(diceType);
    const results: number[] = [];

    for (let i = 0; i < count; i++) {
      results.push(Math.floor(Math.random() * sides) + 1);
    }

    const total = results.reduce((a, b) => a + b, 0);

    const log: DiceRollLog = {
      id: randomUUID(),
      participantId: participant.id,
      participantDisplayName: participant.displayName,
      diceType,
      count,
      results,
      total,
      createdAt: new Date().toISOString(),
    };

    const diceLogs = [...(room.diceLogs ?? []), log];

    await this.prisma.room.update({
      where: { slug: roomSlug },
      data: {
        diceLogs: diceLogs as unknown as object,
      },
    });

    return log;
  }

  async addChatMessage(
    roomSlug: string,
    participant: RoomParticipant,
    text: string,
  ): Promise<ChatMessage> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Message text is required.');
    }

    const room = await this.findRoomOrThrow(roomSlug);

    const message: ChatMessage = {
      id: randomUUID(),
      participantId: participant.id,
      participantDisplayName: participant.displayName,
      text: trimmed.slice(0, 1000),
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...(room.chatMessages ?? []), message].slice(-100);

    await this.prisma.room.update({
      where: { slug: roomSlug },
      data: {
        chatMessages: nextMessages as unknown as object,
      },
    });

    return message;
  }

  private parseDiceSides(diceType: string): number {
    const match = diceType.match(/^d(\d+)$/i);
    if (match) {
      const sides = parseInt(match[1], 10);
      if (sides >= 2 && sides <= 1000) {
        return sides;
      }
    }
    return 6;
  }

  private resolveRegisteredParticipant(
    user: AuthenticatedRequestUser,
    role: RoomParticipant['role'],
  ): RoomParticipant {
    return {
      id: `user:${user.id}`,
      displayName: user.displayName,
      kind: 'registered',
      role,
      userId: user.id,
    };
  }

  private resolveGuestParticipant(
    guestName: string | undefined,
    guestKey: string | undefined,
    role: RoomParticipant['role'],
  ): RoomParticipant {
    const normalizedGuestName = guestName?.trim();

    if (!normalizedGuestName) {
      throw new BadRequestException(
        'Guest users must provide a name before joining the room.',
      );
    }

    const trimmedKey = guestKey?.trim();
    const key =
      trimmedKey && this.isValidGuestKey(trimmedKey)
        ? trimmedKey.toLowerCase()
        : randomUUID();

    return {
      id: `guest:${key}`,
      displayName: normalizedGuestName,
      kind: 'guest',
      role,
    };
  }

  private isValidGuestKey(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private createSession(
    roomSlug: string,
    participant: RoomParticipant,
  ): RoomSession {
    const session: RoomSession = {
      sessionId: randomUUID(),
      roomSlug,
      participant,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      connected: false,
      clientUiPresence: 'active',
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  private createSlug() {
    return randomUUID().split('-')[0];
  }

  private createDefaultCanvas(): RoomCanvasState {
    return {
      backgroundColor: '#f8f1df',
      gridEnabled: true,
      tokens: [
        {
          id: randomUUID(),
          label: 'GM',
          color: '#7c3aed',
          x: 120,
          y: 120,
          size: 40,
        } satisfies CanvasToken,
      ],
      layers: [
        {
          id: randomUUID(),
          name: 'Base',
          visible: true,
          strokes: [],
        },
      ],
      fogEnabled: false,
      fogStrokes: [],
    };
  }

  private normalizeCanvas(canvas: RoomCanvasState): RoomCanvasState {
    const legacyStrokes = Array.isArray((canvas as unknown as { strokes?: unknown }).strokes)
      ? ((canvas as unknown as { strokes: unknown[] }).strokes as unknown[])
      : [];

    const normalizedStrokes = legacyStrokes.map((stroke) => {
      const strokeObject = stroke as Partial<CanvasStroke>;
      return {
        id: strokeObject.id || randomUUID(),
        color: strokeObject.color || '#111827',
        width: Number.isFinite(strokeObject.width) ? (strokeObject.width as number) : 4,
        authorId: strokeObject.authorId || 'unknown',
        points: Array.isArray(strokeObject.points)
          ? strokeObject.points.map((point) => ({
              x: Number((point as CanvasStrokePoint).x) || 0,
              y: Number((point as CanvasStrokePoint).y) || 0,
            }))
          : [],
      } satisfies CanvasStroke;
    });

    const layersInput = (canvas as unknown as { layers?: unknown }).layers;
    const baseLayers = Array.isArray(layersInput)
      ? (layersInput as unknown[]).map((layer) => {
          const layerObject = layer as Partial<{
            id: string;
            name: string;
            visible: boolean;
            strokes: unknown;
          }>;

          const strokes = Array.isArray(layerObject.strokes)
            ? (layerObject.strokes as unknown[]).map((stroke) => {
                const strokeObject = stroke as Partial<CanvasStroke>;
                return {
                  id: strokeObject.id || randomUUID(),
                  color: strokeObject.color || '#111827',
                  width: Number.isFinite(strokeObject.width) ? (strokeObject.width as number) : 4,
                  authorId: strokeObject.authorId || 'unknown',
                  points: Array.isArray(strokeObject.points)
                    ? strokeObject.points.map((point) => ({
                        x: Number((point as CanvasStrokePoint).x) || 0,
                        y: Number((point as CanvasStrokePoint).y) || 0,
                      }))
                    : [],
                } satisfies CanvasStroke;
              })
            : [];

          return {
            id: layerObject.id || randomUUID(),
            name: layerObject.name?.trim() || 'Layer',
            visible: layerObject.visible !== false,
            strokes,
          };
        })
      : [];

    const layers =
      baseLayers.length > 0
        ? baseLayers
        : [
            {
              id: randomUUID(),
              name: 'Base',
              visible: true,
              strokes: normalizedStrokes,
            },
          ];

    const fogStrokesInput = (canvas as unknown as { fogStrokes?: unknown }).fogStrokes;
    const fogStrokes = Array.isArray(fogStrokesInput)
      ? (fogStrokesInput as unknown[]).map((stroke) => {
          const strokeObject = stroke as Partial<{
            id: string;
            width: number;
            points: unknown;
            authorId: string;
          }>;
          return {
            id: strokeObject.id || randomUUID(),
            width: Number.isFinite(strokeObject.width) ? (strokeObject.width as number) : 40,
            authorId: strokeObject.authorId || 'unknown',
            points: Array.isArray(strokeObject.points)
              ? (strokeObject.points as unknown[]).map((point) => ({
                  x: Number((point as CanvasStrokePoint).x) || 0,
                  y: Number((point as CanvasStrokePoint).y) || 0,
                }))
              : [],
          };
        })
      : [];

    return {
      backgroundColor: canvas.backgroundColor || '#f8f1df',
      gridEnabled: Boolean(canvas.gridEnabled),
      tokens: Array.isArray(canvas.tokens)
        ? canvas.tokens.map((token) => {
            const rawCtrl = (token as { controlledByParticipantId?: unknown })
              .controlledByParticipantId;
            const controlledByParticipantId =
              typeof rawCtrl === 'string' && rawCtrl.trim() ? rawCtrl.trim() : undefined;
            return {
              id: token.id || randomUUID(),
              label: token.label || 'Token',
              color: token.color || '#2563eb',
              x: Number(token.x) || 0,
              y: Number(token.y) || 0,
              size: Number(token.size) || 40,
              ...(controlledByParticipantId !== undefined
                ? { controlledByParticipantId }
                : {}),
            };
          })
        : [],
      layers,
      fogEnabled: Boolean((canvas as unknown as { fogEnabled?: unknown }).fogEnabled),
      fogStrokes,
    };
  }

  // JSON persistence removed after migration to PostgreSQL + Prisma.
}
