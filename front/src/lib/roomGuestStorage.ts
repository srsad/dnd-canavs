export type RoomGuestSnapshot = {
  guestKey: string;
  guestName: string;
  /** Guest GM only; persisted so the same browser can reclaim GM after disconnect */
  hostSecret?: string;
};

function key(slug: string) {
  return `dnd-room-guest:${slug}`;
}

export function saveRoomGuestSnapshot(slug: string, data: RoomGuestSnapshot) {
  localStorage.setItem(key(slug), JSON.stringify(data));
}

export function loadRoomGuestSnapshot(slug: string): RoomGuestSnapshot | null {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as RoomGuestSnapshot;
    if (typeof parsed.guestKey !== 'string' || typeof parsed.guestName !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
