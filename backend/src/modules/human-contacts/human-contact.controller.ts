import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedOperator } from '../auth/auth.types';
import { CurrentOperator } from '../auth/current-operator.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

import {
  AddHumanContactNoteDto,
  AssignHumanContactDto,
  normalizeHumanContactListQuery,
  normalizeHumanContactNote,
  normalizeHumanContactOperatorId,
  normalizeHumanContactReply,
  ReplyHumanContactDto,
} from './dto/human-contact.dto';
import { HumanContactWorkflowService } from './human-contact-workflow.service';

@Controller('human-contacts')
@UseGuards(AuthGuard, PermissionsGuard)
export class HumanContactController {
  constructor(private readonly humanContactWorkflowService: HumanContactWorkflowService) {}

  @Get()
  @RequirePermissions('contact.read')
  list(@Query() query: Record<string, unknown>, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.list(normalizeHumanContactListQuery(query), actor);
  }

  @Get(':id')
  @RequirePermissions('contact.read')
  detail(@Param('id') requestId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.detail(requestId, actor);
  }

  @Post(':id/assign')
  @RequirePermissions('contact.assign')
  assign(@Param('id') requestId: string, @Body() input: AssignHumanContactDto, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.assign(requestId, normalizeHumanContactOperatorId(input?.operatorId), actor);
  }

  @Post(':id/start')
  @RequirePermissions('contact.update')
  start(@Param('id') requestId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.start(requestId, actor);
  }

  @Post(':id/note')
  @RequirePermissions('contact.update')
  addNote(@Param('id') requestId: string, @Body() input: AddHumanContactNoteDto, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.addNote(requestId, normalizeHumanContactNote(input), actor);
  }

  @Post(':id/reply')
  @RequirePermissions('contact.update')
  reply(@Param('id') requestId: string, @Body() input: ReplyHumanContactDto, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.reply(requestId, normalizeHumanContactReply(input), actor);
  }

  @Post(':id/close')
  @RequirePermissions('contact.update')
  close(@Param('id') requestId: string, @CurrentOperator() actor: AuthenticatedOperator) {
    return this.humanContactWorkflowService.close(requestId, actor);
  }
}
