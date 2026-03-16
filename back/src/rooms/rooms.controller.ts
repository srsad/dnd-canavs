import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

@Controller('rooms')
@UseGuards(OptionalAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  createRoom(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    return this.roomsService.createRoom({
      title: dto.title,
      guestName: dto.guestName,
      user,
    });
  }

  @Get(':slug')
  getRoom(@Param('slug') slug: string) {
    return this.roomsService.getRoomBySlug(slug);
  }

  @Post(':slug/join')
  joinRoom(
    @Param('slug') slug: string,
    @Body() dto: JoinRoomDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    return this.roomsService.joinRoom({
      slug,
      guestName: dto.guestName,
      user,
    });
  }
}
