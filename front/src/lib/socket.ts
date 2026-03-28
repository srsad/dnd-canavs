import { io, Socket } from 'socket.io-client';

function resolveSocketBase(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return '';
}

const SOCKET_URL = resolveSocketBase();

export function createRoomSocket(roomSlug: string, sessionId: string): Socket {
  const url = SOCKET_URL ? `${SOCKET_URL}/rooms` : '/rooms';
  return io(url, {
    transports: ['websocket'],
    auth: {
      roomSlug,
      sessionId,
    },
  });
}
