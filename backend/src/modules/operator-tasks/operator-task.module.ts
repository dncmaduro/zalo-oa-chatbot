import { Module } from '@nestjs/common';

import { LlmModule } from '../llm/llm.module';
import { AuthModule } from '../auth/auth.module';

import { OperatorTaskController } from './operator-task.controller';
import { OperatorTaskWorkflowService } from './operator-task-workflow.service';

@Module({
  imports: [LlmModule, AuthModule],
  controllers: [OperatorTaskController],
  providers: [OperatorTaskWorkflowService],
})
export class OperatorTaskModule {}
