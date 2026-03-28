import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useRoomStore } from '../stores/room';

/**
 * Нужен запущенный бэкенд (например `npm run docker:dev` или `npm run dev:back`).
 * База: VITE_TEST_API_URL (по умолчанию http://127.0.0.1:3000)
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
    });

    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(store.room).not.toBeNull();
    expect(store.room?.title).toBe('Vitest комната');
    expect(store.sessionId).toBeTruthy();
    expect(store.currentParticipant?.role).toBe('gm');
    expect(store.error).toBeNull();
  });
});
