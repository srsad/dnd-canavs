import { io, Socket } from 'socket.io-client';

const SOCKET_URL =
  import.meta.env.VITE_WS_URL ??
  (import.meta.env.DEV ? '' : 'http://localhost:3000');

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
