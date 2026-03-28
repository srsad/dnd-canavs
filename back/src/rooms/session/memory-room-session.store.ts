import { Injectable } from '@nestjs/common';
import { RoomSession } from '../rooms.types';
import { RoomSessionStore } from './room-session.store';

@Injectable()
export class MemoryRoomSessionStore implements RoomSessionStore {
  private readonly map = new Map<string, RoomSession>();

  async get(sessionId: string): Promise<RoomSession | undefined> {
    return this.map.get(sessionId);
  }

  async set(sessionId: string, session: RoomSession): Promise<void> {
    this.map.set(sessionId, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }

  async findAll(): Promise<RoomSession[]> {
    return [...this.map.values()];
  }
}
