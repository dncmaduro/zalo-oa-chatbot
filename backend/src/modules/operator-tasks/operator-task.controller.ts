import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedOperator } from '../auth/auth.types';
import { CurrentOperator } from '../auth/current-operator.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

import {
  AssignOperatorTaskDto,
  EditOperatorTaskDraftDto,
  normalizeDraftResponse,
  normalizeOperatorId,
  normalizeOperatorTaskListQuery,
  normalizeSubmittedResult,
  SubmitOperatorTaskResultDto,
} from './dto/operator-task.dto';
import { OperatorTaskWorkflowService } from './operator-task-workflow.service';

@Controller('operator-tasks')
@UseGuards(AuthGuard, PermissionsGuard)
export class OperatorTaskController {
  constructor(private readonly operatorTaskWorkflowService: OperatorTaskWorkflowService) {}

  @Get()
  @RequirePermissions('task.read')
  list(@Query() query: Record<string, unknown>, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.list(normalizeOperatorTaskListQuery(query), actor);
  }

  @Get(':id')
  @RequirePermissions('task.read')
  detail(@Param('id') taskId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.detail(taskId, actor);
  }

  @Post(':id/assign')
  @RequirePermissions('task.assign')
  assign(@Param('id') taskId: string, @Body() input: AssignOperatorTaskDto, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.assign(taskId, normalizeOperatorId(input.operatorId), actor);
  }

  @Post(':id/start')
  @RequirePermissions('task.update')
  start(@Param('id') taskId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.start(taskId, actor);
  }

  @Post(':id/result')
  @RequirePermissions('task.update')
  submitResult(@Param('id') taskId: string, @Body() input: SubmitOperatorTaskResultDto, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.submitResult(taskId, normalizeSubmittedResult(input), actor);
  }

  @Post(':id/generate-response')
  @RequirePermissions('task.update')
  generateResponse(@Param('id') taskId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.generateResponse(taskId, actor);
  }

  @Patch(':id/draft')
  @RequirePermissions('task.update')
  editDraft(@Param('id') taskId: string, @Body() input: EditOperatorTaskDraftDto, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.editDraft(taskId, normalizeDraftResponse(input), actor);
  }

  @Post(':id/approve')
  @RequirePermissions('task.complete')
  approve(@Param('id') taskId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.operatorTaskWorkflowService.approve(taskId, actor);
  }
}
