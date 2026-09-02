import { Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { KnowledgeImportService } from './knowledge-import.service';

@Controller('knowledge-import')
export class KnowledgeImportController {
  constructor(private readonly knowledgeImportService: KnowledgeImportService) {}

  @Post('preview')
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
  apply(
    @Param('batchId')
    batchId: string,
  ) {
    return this.knowledgeImportService.apply(batchId);
  }
}
