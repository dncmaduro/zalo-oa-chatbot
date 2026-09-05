import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  ApproveOperatorTaskDto,
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
export class OperatorTaskController {
  constructor(private readonly operatorTaskWorkflowService: OperatorTaskWorkflowService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.operatorTaskWorkflowService.list(normalizeOperatorTaskListQuery(query));
  }

  @Get(':id')
  detail(@Param('id') taskId: string) {
    return this.operatorTaskWorkflowService.detail(taskId);
  }

  @Post(':id/assign')
  assign(@Param('id') taskId: string, @Body() input: AssignOperatorTaskDto) {
    return this.operatorTaskWorkflowService.assign(taskId, normalizeOperatorId(input.operatorId));
  }

  @Post(':id/start')
  start(@Param('id') taskId: string) {
    return this.operatorTaskWorkflowService.start(taskId);
  }

  @Post(':id/result')
  submitResult(@Param('id') taskId: string, @Body() input: SubmitOperatorTaskResultDto) {
    return this.operatorTaskWorkflowService.submitResult(taskId, normalizeSubmittedResult(input));
  }

  @Post(':id/generate-response')
  generateResponse(@Param('id') taskId: string) {
    return this.operatorTaskWorkflowService.generateResponse(taskId);
  }

  @Patch(':id/draft')
  editDraft(@Param('id') taskId: string, @Body() input: EditOperatorTaskDraftDto) {
    return this.operatorTaskWorkflowService.editDraft(taskId, normalizeDraftResponse(input));
  }

  @Post(':id/approve')
  approve(@Param('id') taskId: string, @Body() input: ApproveOperatorTaskDto) {
    return this.operatorTaskWorkflowService.approve(taskId, normalizeOperatorId(input.operatorId));
  }
}
