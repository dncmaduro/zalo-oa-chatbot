import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedOperator } from '../auth/auth.types';
import { CurrentOperator } from '../auth/current-operator.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

import { CreateOperatorDto, normalizeCreateOperator, normalizeOperatorListQuery, normalizeUpdateOperator, UpdateOperatorDto } from './dto/operator.dto';
import { OperatorManagementService } from './operator-management.service';

@Controller('operators')
@UseGuards(AuthGuard, PermissionsGuard)
export class OperatorController {
  constructor(private readonly operatorManagementService: OperatorManagementService) {}

  @Get()
  @RequirePermissions('operator.read')
  list(@Query() query: Record<string, unknown>) {
    return this.operatorManagementService.list(normalizeOperatorListQuery(query));
  }

  @Get(':id')
  @RequirePermissions('operator.read')
  detail(@Param('id') operatorId: string) {
    return this.operatorManagementService.detail(operatorId);
  }

  @Post()
  @RequirePermissions('operator.manage')
  create(@Body() input: CreateOperatorDto) {
    return this.operatorManagementService.create(normalizeCreateOperator(input));
  }

  @Patch(':id')
  @RequirePermissions('operator.manage')
  update(@Param('id') operatorId: string, @Body() input: UpdateOperatorDto) {
    return this.operatorManagementService.update(operatorId, normalizeUpdateOperator(input));
  }

  @Post(':id/activate')
  @RequirePermissions('operator.manage')
  activate(@Param('id') operatorId: string) {
    return this.operatorManagementService.activate(operatorId);
  }

  @Post(':id/deactivate')
  @RequirePermissions('operator.manage')
  deactivate(@Param('id') operatorId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorManagementService.deactivate(operatorId, actor.id);
  }
}
