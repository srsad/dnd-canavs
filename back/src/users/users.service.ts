import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from 'nestjs-prisma';
import { PublicUser, RegisteredUser } from './users.types';

type DbUser = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<RegisteredUser | undefined> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      return undefined;
    }

    return this.fromDbUser(user as DbUser);
  }

  async findById(id: string): Promise<RegisteredUser | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return undefined;
    }

    return this.fromDbUser(user as DbUser);
  }

  async create(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<RegisteredUser> {
    const id = randomUUID();
    const createdAt = new Date();

    const user = await this.prisma.user.create({
      data: {
        id,
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName.trim(),
        passwordHash: input.passwordHash,
        createdAt,
      },
    });

    return this.fromDbUser(user as DbUser);
  }

  toPublicUser(user: RegisteredUser): PublicUser {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }

  private fromDbUser(user: DbUser): RegisteredUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
