import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { OperatorController } from './operator.controller';
import { OperatorManagementService } from './operator-management.service';

@Module({
  imports: [AuthModule],
  controllers: [OperatorController],
  providers: [OperatorManagementService],
})
export class OperatorModule {}
