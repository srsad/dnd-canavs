import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { randomUUID } from '../lib/randomUUID';
import { useRoomStore } from '../stores/room';

/**
 * Нужен запущенный бэкенд (например `npm run docker:dev` или `npm run dev:back`).
 * API: VITE_TEST_API_URL (по умолчанию http://127.0.0.1:3000).
 * Тело как у гостя в UI: guestName + guestKey (требует актуальный DTO с полем guestKey).
 */
describe('create room (integration)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('создаёт комнату через store и API', async () => {
    const store = useRoomStore();
    const slug = await store.createRoom({
      title: 'Vitest комната',
      guestName: 'GM',
      guestKey: randomUUID(),
    });

    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(store.room).not.toBeNull();
    expect(store.room?.title).toBe('Vitest комната');
    expect(store.sessionId).toBeTruthy();
    expect(store.currentParticipant?.role).toBe('gm');
    expect(store.error).toBeNull();
  });
});
