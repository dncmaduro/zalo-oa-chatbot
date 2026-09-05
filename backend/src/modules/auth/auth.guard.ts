import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    if (typeof header !== 'string') throw new UnauthorizedException('Bearer authentication is required');
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (!match) throw new UnauthorizedException('Bearer authentication is required');

    request.auth = await this.authService.authenticate(match[1]);
    return true;
  }
}
