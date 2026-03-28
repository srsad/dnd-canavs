import { Module } from '@nestjs/common';
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
        const connectionString = configService.get<string>('DATABASE_URL');
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
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
    AppService,
    UsersService,
    AuthService,
    JwtAuthGuard,
    OptionalAuthGuard,
    RoomsService,
    RoomsGateway,
  ],
})
export class AppModule {}
