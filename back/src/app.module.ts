import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaModule } from 'nestjs-prisma';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersService } from './users/users.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { OptionalAuthGuard } from './auth/optional-auth.guard';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';
import { RoomsGateway } from './rooms/rooms.gateway';
import { MemoryRoomSessionStore } from './rooms/session/memory-room-session.store';
import { RedisRoomSessionStore } from './rooms/session/redis-room-session.store';
import { ROOM_SESSION_STORE } from './rooms/session/room-session.store';
import { AppExceptionFilter } from './prisma/prisma-exception.filter';
import { S3UploadService } from './storage/s3-upload.service';
import Redis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'dev-secret',
        signOptions: {
          expiresIn: '7d',
        },
      }),
    }),
    PrismaModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString = configService.get<string>('DATABASE_URL')?.trim();
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
        }
        if (
          connectionString.startsWith('prisma+') ||
          connectionString.startsWith('prisma://')
        ) {
          throw new Error(
            'DATABASE_URL должен быть обычным postgresql://… (как в docker-compose). ' +
              'Строки prisma+… / prisma://… здесь не поддерживаются — из-за них был fetch failed.',
          );
        }
        const adapter = new PrismaPg({ connectionString });
        return {
          prismaOptions: { adapter },
        };
      },
    }),
  ],
  controllers: [AppController, AuthController, RoomsController],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    AppService,
    UsersService,
    AuthService,
    JwtAuthGuard,
    OptionalAuthGuard,
    MemoryRoomSessionStore,
    {
      provide: ROOM_SESSION_STORE,
      useFactory: (
        configService: ConfigService,
        memory: MemoryRoomSessionStore,
      ) => {
        const url = configService.get<string>('REDIS_URL')?.trim();
        if (!url) {
          return memory;
        }
        const redis = new Redis(url, { maxRetriesPerRequest: 2 });
        return new RedisRoomSessionStore(redis, 7 * 24 * 3600);
      },
      inject: [ConfigService, MemoryRoomSessionStore],
    },
    RoomsService,
    RoomsGateway,
    S3UploadService,
  ],
})
export class AppModule {}
