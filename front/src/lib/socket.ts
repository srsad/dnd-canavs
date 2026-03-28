import { io, Socket } from 'socket.io-client';

function resolveSocketBase(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return '';
}

const SOCKET_URL = resolveSocketBase();

export type RoomSocketAuth = {
  roomSlug: string;
  sessionId: string;
};

/**
 * Auth is resolved on every Engine.IO handshake so reconnects always send the
 * current sessionId from the store (not a stale closure).
 */
export function createRoomSocket(getAuth: () => RoomSocketAuth | null): Socket {
  const url = SOCKET_URL ? `${SOCKET_URL}/rooms` : '/rooms';
  return io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    auth: (cb) => {
      const auth = getAuth();
      if (!auth?.roomSlug || !auth?.sessionId) {
        cb({});
        return;
      }
      cb({
        roomSlug: auth.roomSlug,
        sessionId: auth.sessionId,
      });
    },
  });
}
