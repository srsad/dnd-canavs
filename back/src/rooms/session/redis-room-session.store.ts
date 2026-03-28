import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { RoomSession } from '../rooms.types';
import { RoomSessionStore } from './room-session.store';

const ALL_KEY = 'dnd:rsess:all';
const sessKey = (id: string) => `dnd:rsess:${id}`;

@Injectable()
export class RedisRoomSessionStore implements RoomSessionStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisRoomSessionStore.name);

  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  async get(sessionId: string): Promise<RoomSession | undefined> {
    const raw = await this.redis.get(sessKey(sessionId));
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as RoomSession;
    } catch {
      this.logger.warn(`Corrupt session JSON for ${sessionId}`);
      return undefined;
    }
  }

  async set(sessionId: string, session: RoomSession): Promise<void> {
    const key = sessKey(sessionId);
    const pipe = this.redis.multi();
    pipe.set(key, JSON.stringify(session), 'EX', this.ttlSeconds);
    pipe.sadd(ALL_KEY, sessionId);
    await pipe.exec();
  }

  async delete(sessionId: string): Promise<void> {
    const key = sessKey(sessionId);
    const pipe = this.redis.multi();
    pipe.del(key);
    pipe.srem(ALL_KEY, sessionId);
    await pipe.exec();
  }

  async findAll(): Promise<RoomSession[]> {
    const ids = await this.redis.smembers(ALL_KEY);
    if (ids.length === 0) {
      return [];
    }
    const keys = ids.map(sessKey);
    const values = await this.redis.mget(...keys);
    const out: RoomSession[] = [];
    const stale: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const raw = values[i];
      if (!raw) {
        stale.push(ids[i]);
        continue;
      }
      try {
        out.push(JSON.parse(raw) as RoomSession);
      } catch {
        stale.push(ids[i]);
      }
    }
    if (stale.length > 0) {
      const pipe = this.redis.multi();
      for (const id of stale) {
        pipe.del(sessKey(id));
        pipe.srem(ALL_KEY, id);
      }
      await pipe.exec();
    }
    return out;
  }
}
