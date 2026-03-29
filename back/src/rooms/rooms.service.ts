import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from 'nestjs-prisma';
import { AuthenticatedRequestUser } from '../auth/auth.types';
import {
  effectivePermissions,
  mergeParticipantWithAcl,
} from './rooms.permissions';
import type { RoomSessionStore } from './session/room-session.store';
import { ROOM_SESSION_STORE } from './session/room-session.store';
import {
  CanvasToken,
  CanvasStroke,
  CanvasStrokePoint,
  ChatMessage,
  DiceRollLog,
  RoomCanvasState,
  ParticipantAcl,
  ParticipantPresence,
  RoomParticipant,
  RoomParticipantPermissions,
  RoomParticipantWithPresence,
  RoomRecord,
  RoomSession,
} from './rooms.types';

@Injectable()
export class RoomsService {
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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ROOM_SESSION_STORE) private readonly sessionStore: RoomSessionStore,
  ) {}

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
      participantAcl: {},
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
        participantAcl: {},
      },
    });

    const session = await this.createSession(slug, creator);
    await this.evictOtherSessionsForRoomParticipant(
      slug,
      creator.id,
      session.sessionId,
    );

    await this.appendAudit(room.id, creator.id, 'room_created', {
      title: room.title,
    });

    return {
      room: {
        ...this.serializeRoom(room),
        createdBy: mergeParticipantWithAcl(creator, room.participantAcl),
      },
      participant: mergeParticipantWithAcl(creator, room.participantAcl),
      sessionId: session.sessionId,
      guestKey:
        creator.kind === 'guest' ? creator.id.replace(/^guest:/, '') : undefined,
      hostSecret: hostSecretPlain,
    };
  }

  async getRoomBySlug(slug: string) {
    const room = await this.findRoomOrThrow(slug);

    return {
      room: {
        ...this.serializeRoom(room),
        createdBy: mergeParticipantWithAcl(room.createdBy, room.participantAcl),
      },
      participants: await this.listParticipants(slug, room.createdBy),
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
      const session = await this.createSession(input.slug, participant);
      await this.evictOtherSessionsForRoomParticipant(
        input.slug,
        participant.id,
        session.sessionId,
      );

      await this.appendAudit(room.id, participant.id, 'participant_join', {
        displayName: participant.displayName,
        role: participant.role,
      });

      return {
        room: {
          ...this.serializeRoom(room),
          createdBy: mergeParticipantWithAcl(room.createdBy, room.participantAcl),
        },
        participant: mergeParticipantWithAcl(participant, room.participantAcl),
        sessionId: session.sessionId,
        participants: await this.listParticipants(input.slug, room.createdBy),
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

    const session = await this.createSession(input.slug, participant);

    if (participant.id === room.createdBy.id) {
      await this.evictOtherSessionsForRoomParticipant(
        input.slug,
        participant.id,
        session.sessionId,
      );
    }

    await this.appendAudit(room.id, participant.id, 'participant_join', {
      displayName: participant.displayName,
      role: participant.role,
    });

    return {
      room: {
        ...this.serializeRoom(room),
        createdBy: mergeParticipantWithAcl(room.createdBy, room.participantAcl),
      },
      participant: mergeParticipantWithAcl(participant, room.participantAcl),
      sessionId: session.sessionId,
      participants: await this.listParticipants(input.slug, room.createdBy),
      guestKey:
        participant.kind === 'guest'
          ? participant.id.replace(/^guest:/, '')
          : undefined,
    };
  }

  async replaceCanvas(
    slug: string,
    canvas: RoomCanvasState,
    actor?: RoomParticipant | null,
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

    await this.appendAudit(room.id, actor?.id ?? null, 'canvas_replace', {
      tokenCount: normalized.tokens.length,
      layerCount: normalized.layers.length,
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
    const perms = effectivePermissions(participant);
    const canMoveAny = perms.moveAnyToken;

    const allowed = new Map<string, { x: number; y: number }>();
    for (const raw of moves) {
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) continue;
      const token = canvas.tokens.find((t) => t.id === id);
      if (!token) continue;
      if (canMoveAny) {
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

    await this.appendAudit(room.id, participant.id, 'token_move', {
      count: allowed.size,
      ids: [...allowed.keys()],
    });

    return nextCanvas;
  }

  async validateSession(sessionId: string, roomSlug: string) {
    await this.pruneStaleSessions();

    const raw = await this.sessionStore.get(sessionId);

    if (!raw || raw.roomSlug !== roomSlug) {
      throw new NotFoundException('Session not found.');
    }

    if (!this.isSessionWithinGrace(raw)) {
      await this.sessionStore.delete(sessionId);
      throw new NotFoundException('Session not found.');
    }

    const room = await this.findRoomOrThrow(roomSlug);
    const identity = this.stripPermissions(raw.participant);
    const mergedParticipant = mergeParticipantWithAcl(identity, room.participantAcl);

    raw.lastSeenAt = new Date().toISOString();
    raw.participant = identity;
    await this.sessionStore.set(sessionId, raw);

    return {
      session: { ...raw, participant: mergedParticipant },
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
  private async evictOtherSessionsForRoomParticipant(
    roomSlug: string,
    participantId: string,
    keepSessionId: string,
  ) {
    const all = await this.sessionStore.findAll();
    for (const sess of all) {
      if (sess.sessionId === keepSessionId) {
        continue;
      }
      if (sess.roomSlug === roomSlug && sess.participant.id === participantId) {
        if (sess.socketId) {
          this.staleSocketsToKick.push({
            socketId: sess.socketId,
            roomSlug: sess.roomSlug,
          });
        }
        await this.sessionStore.delete(sess.sessionId);
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
  async markSocketDisconnected(
    sessionId: string,
    disconnectingSocketId: string,
  ): Promise<boolean> {
    const session = await this.sessionStore.get(sessionId);
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
    await this.sessionStore.set(sessionId, session);
    return true;
  }

  /**
   * @returns previous socket id if it should be disconnected (another tab took over)
   */
  async markSocketConnected(
    sessionId: string,
    socketId: string,
  ): Promise<string | undefined> {
    const session = await this.sessionStore.get(sessionId);
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
    await this.sessionStore.set(sessionId, session);
    return previous;
  }

  async updateSessionClientPresence(
    sessionId: string,
    state: 'active' | 'away',
  ): Promise<void> {
    const session = await this.sessionStore.get(sessionId);
    if (!session || !session.connected) {
      return;
    }
    session.clientUiPresence = state;
    await this.sessionStore.set(sessionId, session);
  }

  async listParticipants(
    roomSlug: string,
    owner?: RoomParticipant,
  ): Promise<RoomParticipantWithPresence[]> {
    await this.pruneStaleSessions();

    let acl: ParticipantAcl = {};
    try {
      const roomRow = await this.findRoomOrThrow(roomSlug);
      acl = roomRow.participantAcl;
    } catch {
      acl = {};
    }

    const sessionsHere = (await this.sessionStore.findAll()).filter(
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
        ...mergeParticipantWithAcl(owner, acl),
        presence: presenceByParticipantId.get(owner.id) ?? 'offline',
      });
      seen.add(owner.id);
    }

    for (const s of sessionsHere) {
      if (seen.has(s.participant.id)) {
        continue;
      }
      seen.add(s.participant.id);
      const merged = mergeParticipantWithAcl(s.participant, acl);
      result.push({
        ...merged,
        presence:
          presenceByParticipantId.get(s.participant.id) ?? 'offline',
      });
    }

    return result;
  }

  private async pruneStaleSessions() {
    const all = await this.sessionStore.findAll();
    for (const session of all) {
      if (!this.isSessionWithinGrace(session)) {
        await this.sessionStore.delete(session.sessionId);
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

  async findRoomOrThrow(slug: string): Promise<RoomRecord> {
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
      participantAcl:
        (dbRoom.participantAcl as unknown as ParticipantAcl) ?? {},
    };

    return room;
  }

  serializeRoom(room: RoomRecord) {
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

    await this.appendAudit(room.id, participant.id, 'dice_roll', {
      diceType,
      count,
      total: log.total,
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

    await this.appendAudit(room.id, participant.id, 'chat_message', {
      length: message.text.length,
    });

    return message;
  }

  assertCanManageRoom(
    room: RoomRecord,
    user: AuthenticatedRequestUser | undefined,
    hostSecret?: string,
  ) {
    if (room.createdBy.kind === 'registered') {
      if (!user || room.createdBy.userId !== user.id) {
        throw new ForbiddenException('Only the room owner can do this.');
      }
      return;
    }
    if (
      !room.hostSecretHash ||
      !hostSecret ||
      !this.verifyHostSecret(hostSecret, room.hostSecretHash)
    ) {
      throw new ForbiddenException('Host secret required.');
    }
  }

  async exportRoomSnapshot(slug: string) {
    const room = await this.findRoomOrThrow(slug);
    return {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      title: room.title,
      canvas: room.canvas,
      diceLogs: room.diceLogs ?? [],
      canvasHistory: room.canvasHistory ?? [],
      chatMessages: room.chatMessages ?? [],
      participantAcl: room.participantAcl ?? {},
    };
  }

  async importRoomSnapshot(
    payload: {
      version: number;
      title: string;
      canvas: RoomCanvasState;
      diceLogs?: DiceRollLog[];
      canvasHistory?: RoomCanvasState[];
      chatMessages?: ChatMessage[];
      participantAcl?: ParticipantAcl;
    },
    user: AuthenticatedRequestUser,
  ) {
    if (payload.version !== 1) {
      throw new BadRequestException('Unsupported export version.');
    }
    const title = payload.title?.trim();
    if (!title || title.length < 3) {
      throw new BadRequestException('Invalid room title in import.');
    }

    const creator = this.resolveRegisteredParticipant(user, 'gm');
    const slug = this.createSlug();
    const room: RoomRecord = {
      id: randomUUID(),
      slug,
      title,
      createdAt: new Date().toISOString(),
      createdBy: creator,
      canvas: this.normalizeCanvas(payload.canvas),
      diceLogs: Array.isArray(payload.diceLogs) ? payload.diceLogs : [],
      canvasHistory: Array.isArray(payload.canvasHistory)
        ? payload.canvasHistory.map((c) => this.normalizeCanvas(c))
        : [],
      chatMessages: Array.isArray(payload.chatMessages) ? payload.chatMessages : [],
      hostSecretHash: null,
      participantAcl: payload.participantAcl ?? {},
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
        hostSecretHash: null,
        participantAcl: room.participantAcl as unknown as object,
      },
    });

    await this.appendAudit(room.id, creator.id, 'room_imported', {
      title: room.title,
    });

    return {
      room: this.serializeRoom(room),
      slug: room.slug,
    };
  }

  async updateParticipantAcl(
    slug: string,
    targetParticipantId: string,
    patch: {
      permissions?: Partial<RoomParticipantPermissions>;
      clear?: boolean;
    },
  ) {
    const room = await this.findRoomOrThrow(slug);
    const acl: ParticipantAcl = { ...(room.participantAcl ?? {}) };

    if (patch.clear) {
      delete acl[targetParticipantId];
    } else if (patch.permissions && Object.keys(patch.permissions).length > 0) {
      const prev = acl[targetParticipantId] ?? {};
      acl[targetParticipantId] = {
        permissions: {
          ...prev.permissions,
          ...patch.permissions,
        },
      };
    }

    await this.prisma.room.update({
      where: { slug },
      data: { participantAcl: acl as unknown as object },
    });

    return { participantAcl: acl };
  }

  async listAuditEvents(slug: string, skip = 0, take = 50) {
    const room = await this.findRoomOrThrow(slug);
    const limit = Math.min(Math.max(take, 1), 100);
    const sk = Math.max(skip, 0);
    const events = await this.prisma.roomAuditEvent.findMany({
      where: { roomId: room.id },
      orderBy: { createdAt: 'desc' },
      skip: sk,
      take: limit + 1,
    });
    const hasMore = events.length > limit;
    const slice = hasMore ? events.slice(0, limit) : events;
    return {
      events: slice.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        actorId: e.actorId,
        type: e.type,
        payload: e.payload,
      })),
      hasMore,
      nextSkip: hasMore ? sk + limit : sk,
    };
  }

  private async appendAudit(
    roomId: string,
    actorId: string | null,
    type: string,
    payload: unknown,
  ) {
    await this.prisma.roomAuditEvent.create({
      data: {
        id: randomUUID(),
        roomId,
        actorId,
        type,
        payload: payload as object,
      },
    });
  }

  private stripPermissions(participant: RoomParticipant): RoomParticipant {
    const { permissions: _omit, ...rest } = participant;
    return rest;
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

  private async createSession(
    roomSlug: string,
    participant: RoomParticipant,
  ): Promise<RoomSession> {
    const session: RoomSession = {
      sessionId: randomUUID(),
      roomSlug,
      participant: this.stripPermissions(participant),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      connected: false,
      clientUiPresence: 'active',
    };

    await this.sessionStore.set(session.sessionId, session);
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
      canvasImages: [],
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

    const MIN_IMG = 8;
    const MAX_IMG_DIM = 8192;
    const canvasImagesInput = (canvas as unknown as { canvasImages?: unknown }).canvasImages;
    const canvasImages = Array.isArray(canvasImagesInput)
      ? (canvasImagesInput as unknown[])
          .map((raw) => {
            const img = raw as Partial<{
              id: string;
              layerId: string;
              url: string;
              x: number;
              y: number;
              width: number;
              height: number;
              rotation: number;
            }>;
            const url = typeof img.url === 'string' ? img.url.trim() : '';
            if (!url.startsWith('https://')) {
              return null;
            }
            const layerIdSet = new Set(layers.map((l) => l.id));
            const rawLayerId = typeof img.layerId === 'string' ? img.layerId.trim() : '';
            const layerId = layerIdSet.has(rawLayerId) ? rawLayerId : (layers[0]?.id ?? '');
            let w = Number(img.width);
            let h = Number(img.height);
            if (!Number.isFinite(w) || w < MIN_IMG) w = MIN_IMG;
            if (!Number.isFinite(h) || h < MIN_IMG) h = MIN_IMG;
            w = Math.min(w, MAX_IMG_DIM);
            h = Math.min(h, MAX_IMG_DIM);
            let rot = Number(img.rotation);
            if (!Number.isFinite(rot)) rot = 0;
            rot = ((((rot + 180) % 360) + 360) % 360) - 180;
            return {
              id: img.id || randomUUID(),
              layerId,
              url,
              x: Number(img.x) || 0,
              y: Number(img.y) || 0,
              width: w,
              height: h,
              rotation: rot,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
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
      canvasImages,
      fogEnabled: Boolean((canvas as unknown as { fogEnabled?: unknown }).fogEnabled),
      fogStrokes,
    };
  }

  // JSON persistence removed after migration to PostgreSQL + Prisma.
}
