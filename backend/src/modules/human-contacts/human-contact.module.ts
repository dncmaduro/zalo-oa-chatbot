import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { HumanContactController } from './human-contact.controller';
import { HumanContactWorkflowService } from './human-contact-workflow.service';

@Module({
  imports: [AuthModule],
  controllers: [HumanContactController],
  providers: [HumanContactWorkflowService],
})
export class HumanContactModule {}
