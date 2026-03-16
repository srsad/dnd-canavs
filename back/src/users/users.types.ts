export type RegisteredUser = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
};

export type PublicUser = Omit<RegisteredUser, 'passwordHash'>;
