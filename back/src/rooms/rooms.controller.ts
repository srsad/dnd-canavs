import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

@Controller('rooms')
@UseGuards(OptionalAuthGuard)
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly roomsGateway: RoomsGateway,
  ) {}

  @Post()
  async createRoom(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    const result = await this.roomsService.createRoom({
      title: dto.title,
      guestName: dto.guestName,
      guestKey: dto.guestKey ?? window.crypto.randomUUID(),
      user,
    });
    await this.roomsGateway.disconnectStaleSockets();
    return result;
  }

  @Get(':slug')
  getRoom(@Param('slug') slug: string) {
    return this.roomsService.getRoomBySlug(slug);
  }

  @Get(':slug/canvas-history')
  getCanvasHistory(@Param('slug') slug: string) {
    return this.roomsService.getCanvasHistory(slug);
  }

  @Post(':slug/join')
  async joinRoom(
    @Param('slug') slug: string,
    @Body() dto: JoinRoomDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    const result = await this.roomsService.joinRoom({
      slug,
      guestName: dto.guestName,
      guestKey: dto.guestKey,
      hostSecret: dto.hostSecret,
      user,
    });
    await this.roomsGateway.disconnectStaleSockets();
    return result;
  }
}
