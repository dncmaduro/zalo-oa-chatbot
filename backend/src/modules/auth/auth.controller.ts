import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentOperator } from './current-operator.decorator';
import { CurrentSessionId } from './current-session.decorator';
import { LoginDto, normalizeLogin } from './dto/auth.dto';
import { AuthenticatedOperator } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() input: LoginDto) {
    return this.authService.login(normalizeLogin(input));
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@CurrentSessionId() sessionId: string) {
    await this.authService.logout(sessionId);
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentOperator() operator: AuthenticatedOperator) {
    return operator;
  }
}
