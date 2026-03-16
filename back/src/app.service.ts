import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getOverview() {
    return {
      name: 'dnd-canvas-api',
      status: 'ok',
      features: [
        'JWT authentication for registered users',
        'Guest join flow for anonymous users',
        'Room creation and connection by link',
        'Realtime synchronized battle map via socket.io',
      ],
    };
  }
}
