import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FileStoreService } from '../storage/file-store.service';
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
  private readonly fileName = 'rooms.json';
  private readonly sessions = new Map<string, RoomSession>();

  constructor(private readonly fileStore: FileStoreService) {}

  async createRoom(input: {
    title: string;
    user?: AuthenticatedRequestUser;
    guestName?: string;
  }) {
    const rooms = await this.readAll();
    const creator = this.resolveParticipant(input.user, input.guestName);
    const slug = this.createSlug();

    const room: RoomRecord = {
      id: randomUUID(),
      slug,
      title: input.title.trim(),
      createdAt: new Date().toISOString(),
      createdBy: creator,
      canvas: this.createDefaultCanvas(),
      diceLogs: [],
    };

    rooms.push(room);
    await this.fileStore.writeJson(this.fileName, rooms);

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
    const participant = this.resolveParticipant(input.user, input.guestName);
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
    const rooms = await this.readAll();
    const room = rooms.find((item) => item.slug === slug);

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

    room.canvas = this.normalizeCanvas(canvas);
    await this.fileStore.writeJson(this.fileName, rooms);
    return room.canvas;
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
    const rooms = await this.readAll();
    const room = rooms.find((item) => item.slug === slug);

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

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
    };
  }

  async addDiceRoll(
    roomSlug: string,
    participant: RoomParticipant,
    diceType: string,
    count: number,
  ): Promise<DiceRollLog> {
    const rooms = await this.readAll();
    const room = rooms.find((r) => r.slug === roomSlug);

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

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

    if (!room.diceLogs) {
      room.diceLogs = [];
    }
    room.diceLogs.push(log);
    await this.fileStore.writeJson(this.fileName, rooms);

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
    user?: AuthenticatedRequestUser,
    guestName?: string,
  ): RoomParticipant {
    if (user) {
      return {
        id: `user:${user.id}`,
        displayName: user.displayName,
        kind: 'registered',
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
    };
  }

  private createSession(roomSlug: string, participant: RoomParticipant): RoomSession {
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

  private async readAll(): Promise<RoomRecord[]> {
    return this.fileStore.readJson<RoomRecord[]>(this.fileName, []);
  }
}
