import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FileStoreService } from '../storage/file-store.service';
import { PublicUser, RegisteredUser } from './users.types';

@Injectable()
export class UsersService {
  private readonly fileName = 'users.json';

  constructor(private readonly fileStore: FileStoreService) {}

  async findByEmail(email: string): Promise<RegisteredUser | undefined> {
    const users = await this.readAll();
    return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  }

  async findById(id: string): Promise<RegisteredUser | undefined> {
    const users = await this.readAll();
    return users.find((user) => user.id === id);
  }

  async create(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<RegisteredUser> {
    const users = await this.readAll();

    const newUser: RegisteredUser = {
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await this.fileStore.writeJson(this.fileName, users);

    return newUser;
  }

  toPublicUser(user: RegisteredUser): PublicUser {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }

  private async readAll(): Promise<RegisteredUser[]> {
    return this.fileStore.readJson<RegisteredUser[]>(this.fileName, []);
  }
}
