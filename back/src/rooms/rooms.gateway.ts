import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';
import { RoomCanvasState } from './rooms.types';

type RoomSocket = Socket & {
  data: {
    roomSlug?: string;
    sessionId?: string;
  };
};

@WebSocketGateway({
  namespace: '/rooms',
  cors: { origin: true, credentials: true },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly roomsService: RoomsService) {}

  async handleConnection(client: RoomSocket) {
    const roomSlug = this.readHandshakeValue(client, 'roomSlug');
    const sessionId = this.readHandshakeValue(client, 'sessionId');

    if (!roomSlug || !sessionId) {
      client.disconnect();
      return;
    }

    try {
      const { room } = await this.roomsService.validateSession(sessionId, roomSlug);

      client.data.roomSlug = roomSlug;
      client.data.sessionId = sessionId;
      client.join(roomSlug);

      client.emit('room_state', {
        room,
        participants: this.roomsService.listParticipants(roomSlug, room.createdBy),
      });

      this.server.to(roomSlug).emit('presence_updated', {
        participants: this.roomsService.listParticipants(roomSlug, room.createdBy),
      });
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: RoomSocket) {
    const roomSlug = client.data.roomSlug;
    const sessionId = client.data.sessionId;

    if (!roomSlug || !sessionId) {
      return;
    }

    this.roomsService.disconnectSession(sessionId);
    const roomData = await this.roomsService.getRoomBySlug(roomSlug).catch(() => undefined);

    this.server.to(roomSlug).emit('presence_updated', {
      participants: this.roomsService.listParticipants(
        roomSlug,
        roomData?.room.createdBy,
      ),
    });
  }

  @SubscribeMessage('canvas:replace')
  async replaceCanvas(
    @ConnectedSocket() client: RoomSocket,
    @MessageBody() body: { canvas: RoomCanvasState },
  ) {
    const roomSlug = client.data.roomSlug;

    if (!roomSlug) {
      return;
    }

    const canvas = await this.roomsService.replaceCanvas(roomSlug, body.canvas);

    this.server.to(roomSlug).emit('canvas_updated', {
      canvas,
    });
  }

  @SubscribeMessage('dice:roll')
  async rollDice(
    @ConnectedSocket() client: RoomSocket,
    @MessageBody() body: { diceType: string; count?: number },
  ) {
    const roomSlug = client.data.roomSlug;
    const sessionId = client.data.sessionId;

    if (!roomSlug || !sessionId) {
      return;
    }

    try {
      const { session } = await this.roomsService.validateSession(
        sessionId,
        roomSlug,
      );
      const count = Math.max(1, Math.min(20, Number(body.count) || 1));
      const diceType =
        typeof body.diceType === 'string' && body.diceType
          ? body.diceType.toLowerCase().trim()
          : 'd6';

      const log = await this.roomsService.addDiceRoll(
        roomSlug,
        session.participant,
        diceType,
        count,
      );

      this.server.to(roomSlug).emit('dice_log_added', { log });
    } catch {
      // session invalid — ignore
    }
  }

  private readHandshakeValue(client: Socket, key: 'roomSlug' | 'sessionId') {
    const value = client.handshake.auth[key] ?? client.handshake.query[key];

    return typeof value === 'string' ? value : undefined;
  }
}
