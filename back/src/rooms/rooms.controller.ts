import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { ExportRoomDto } from './dto/export-room.dto';
import { ImportRoomDto } from './dto/import-room.dto';
import { UpdateParticipantAclDto } from './dto/update-participant-acl.dto';
import type {
  ChatMessage,
  DiceRollLog,
  ParticipantAcl,
  RoomCanvasState,
} from './rooms.types';

@Controller('rooms')
@UseGuards(OptionalAuthGuard)
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly roomsGateway: RoomsGateway,
  ) {}

  @Post('import')
  @UseGuards(JwtAuthGuard)
  async importRoom(
    @Body() body: ImportRoomDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    const result = await this.roomsService.importRoomSnapshot(
      {
        version: body.version,
        title: body.title,
        canvas: body.canvas as RoomCanvasState,
        diceLogs: body.diceLogs as DiceRollLog[] | undefined,
        canvasHistory: body.canvasHistory as RoomCanvasState[] | undefined,
        chatMessages: body.chatMessages as ChatMessage[] | undefined,
        participantAcl: body.participantAcl as ParticipantAcl | undefined,
      },
      user,
    );
    return result;
  }

  @Post()
  async createRoom(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    const result = await this.roomsService.createRoom({
      title: dto.title,
      guestName: dto.guestName,
      guestKey: dto.guestKey ?? randomUUID(),
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

  @Post(':slug/export')
  async exportRoom(
    @Param('slug') slug: string,
    @Body() dto: ExportRoomDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    const room = await this.roomsService.findRoomOrThrow(slug);
    this.roomsService.assertCanManageRoom(room, user, dto.hostSecret);
    return this.roomsService.exportRoomSnapshot(slug);
  }

  @Post(':slug/audit/query')
  async queryAudit(
    @Param('slug') slug: string,
    @Body() body: { hostSecret?: string; skip?: number; take?: number },
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    const room = await this.roomsService.findRoomOrThrow(slug);
    this.roomsService.assertCanManageRoom(room, user, body.hostSecret);
    return this.roomsService.listAuditEvents(
      slug,
      body.skip ?? 0,
      body.take ?? 50,
    );
  }

  @Patch(':slug/participants/:participantId/permissions')
  async updateParticipantPermissions(
    @Param('slug') slug: string,
    @Param('participantId') participantId: string,
    @Body() dto: UpdateParticipantAclDto,
    @CurrentUser() user?: AuthenticatedRequestUser,
  ) {
    const room = await this.roomsService.findRoomOrThrow(slug);
    this.roomsService.assertCanManageRoom(room, user, dto.hostSecret);
    const permissions =
      dto.editCanvas === undefined &&
      dto.moveAnyToken === undefined &&
      dto.manageParticipants === undefined
        ? undefined
        : {
            ...(dto.editCanvas !== undefined ? { editCanvas: dto.editCanvas } : {}),
            ...(dto.moveAnyToken !== undefined ? { moveAnyToken: dto.moveAnyToken } : {}),
            ...(dto.manageParticipants !== undefined
              ? { manageParticipants: dto.manageParticipants }
              : {}),
          };
    return this.roomsService.updateParticipantAcl(slug, participantId, {
      clear: dto.clear === true,
      permissions,
    });
  }
}
