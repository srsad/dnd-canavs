import { PublicUser } from '../users/users.types';

export type AuthenticatedRequestUser = PublicUser;

export type JwtPayload = {
  sub: string;
  email: string;
  displayName: string;
};
