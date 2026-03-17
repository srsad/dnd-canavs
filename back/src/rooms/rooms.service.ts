import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from 'nestjs-prisma';
import { AuthenticatedRequestUser } from '../auth/auth.types';
import {
  CanvasToken,
  DiceRollLog,
  RoomCanvasState,
  RoomParticipant,
  RoomRecord,
  RoomSession,
} from './rooms.types';

@Injectable()
export class RoomsService {
  private readonly sessions = new Map<string, RoomSession>();

  constructor(private readonly prisma: PrismaService) {}

  async createRoom(input: {
    title: string;
    user?: AuthenticatedRequestUser;
    guestName?: string;
  }) {
    const creator = this.resolveParticipant(input.user, input.guestName, 'gm');
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
      },
    });

    const session = this.createSession(slug, creator);

    return {
      room: this.serializeRoom(room),
      participant: creator,
      sessionId: session.sessionId,
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
  }) {
    const room = await this.findRoomOrThrow(input.slug);
    const participant = this.resolveParticipant(input.user, input.guestName, 'player');
    const session = this.createSession(input.slug, participant);

    return {
      room: this.serializeRoom(room),
      participant,
      sessionId: session.sessionId,
      participants: this.listParticipants(input.slug, room.createdBy),
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

  async validateSession(sessionId: string, roomSlug: string) {
    const session = this.sessions.get(sessionId);

    if (!session || session.roomSlug !== roomSlug) {
      throw new NotFoundException('Session not found.');
    }

    session.lastSeenAt = new Date().toISOString();

    const room = await this.findRoomOrThrow(roomSlug);

    return {
      session,
      room,
    };
  }

  disconnectSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  listParticipants(roomSlug: string, owner?: RoomParticipant): RoomParticipant[] {
    const uniqueParticipants = new Map<string, RoomParticipant>();

    if (owner) {
      uniqueParticipants.set(owner.id, owner);
    }

    for (const session of this.sessions.values()) {
      if (session.roomSlug === roomSlug) {
        uniqueParticipants.set(session.participant.id, session.participant);
      }
    }

    return [...uniqueParticipants.values()];
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
      canvas: dbRoom.canvas as unknown as RoomCanvasState,
      diceLogs: (dbRoom.diceLogs as unknown as DiceRollLog[]) ?? [],
      canvasHistory: (dbRoom.canvasHistory as unknown as RoomCanvasState[]) ?? [],
      chatMessages: (dbRoom.chatMessages as unknown as ChatMessage[]) ?? [],
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

  private resolveParticipant(
    user: AuthenticatedRequestUser | undefined,
    guestName: string | undefined,
    role: RoomParticipant['role'],
  ): RoomParticipant {
    if (user) {
      return {
        id: `user:${user.id}`,
        displayName: user.displayName,
        kind: 'registered',
        role,
        userId: user.id,
      };
    }

    const normalizedGuestName = guestName?.trim();

    if (!normalizedGuestName) {
      throw new BadRequestException(
        'Guest users must provide a name before joining the room.',
      );
    }

    return {
      id: `guest:${randomUUID()}`,
      displayName: normalizedGuestName,
      kind: 'guest',
      role,
    };
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
      strokes: [],
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
    };
  }

  private normalizeCanvas(canvas: RoomCanvasState): RoomCanvasState {
    return {
      backgroundColor: canvas.backgroundColor || '#f8f1df',
      gridEnabled: Boolean(canvas.gridEnabled),
      strokes: Array.isArray(canvas.strokes)
        ? canvas.strokes.map((stroke) => ({
            id: stroke.id || randomUUID(),
            color: stroke.color || '#111827',
            width: Number.isFinite(stroke.width) ? stroke.width : 4,
            authorId: stroke.authorId || 'unknown',
            points: Array.isArray(stroke.points)
              ? stroke.points.map((point) => ({
                  x: Number(point.x) || 0,
                  y: Number(point.y) || 0,
                }))
              : [],
          }))
        : [],
      tokens: Array.isArray(canvas.tokens)
        ? canvas.tokens.map((token) => ({
            id: token.id || randomUUID(),
            label: token.label || 'Token',
            color: token.color || '#2563eb',
            x: Number(token.x) || 0,
            y: Number(token.y) || 0,
            size: Number(token.size) || 40,
          }))
        : [],
    };
  }

  // JSON persistence removed after migration to PostgreSQL + Prisma.
}
