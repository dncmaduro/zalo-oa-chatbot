import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest().auth.sessionId,
);
