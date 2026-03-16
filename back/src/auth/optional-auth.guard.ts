import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedRequestUser } from './auth.types';

type AuthenticatedRequest = Request & {
  user?: AuthenticatedRequestUser;
};

@Injectable()
export class OptionalAuthGuard extends JwtAuthGuard {
  constructor(authService: AuthService) {
    super(authService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      return true;
    }

    try {
      request.user = await this.authService.verifyToken(token);
    } catch {
      request.user = undefined;
    }

    return true;
  }
}
