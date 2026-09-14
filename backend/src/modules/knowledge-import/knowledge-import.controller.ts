import { Controller, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

import { KnowledgeImportService } from './knowledge-import.service';

@Controller('knowledge-import')
@UseGuards(AuthGuard, PermissionsGuard)
export class KnowledgeImportController {
  constructor(private readonly knowledgeImportService: KnowledgeImportService) {}

  @Post('preview')
  @RequirePermissions('knowledge.import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  preview(
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.knowledgeImportService.preview(file);
  }

  @Post(':batchId/apply')
  @RequirePermissions('knowledge.import')
  apply(
    @Param('batchId')
    batchId: string,
  ) {
    return this.knowledgeImportService.apply(batchId);
  }
}
