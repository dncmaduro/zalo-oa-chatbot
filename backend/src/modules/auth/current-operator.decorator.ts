import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedOperator } from './auth.types';

export const CurrentOperator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedOperator => context.switchToHttp().getRequest().auth.operator,
);
