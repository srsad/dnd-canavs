import { RoomSession } from '../rooms.types';

export const ROOM_SESSION_STORE = Symbol('ROOM_SESSION_STORE');

export interface RoomSessionStore {
  get(sessionId: string): Promise<RoomSession | undefined>;
  set(sessionId: string, session: RoomSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
  findAll(): Promise<RoomSession[]>;
}
