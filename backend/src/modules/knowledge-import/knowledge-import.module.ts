import { Module } from '@nestjs/common';

import { KnowledgeImportController } from './knowledge-import.controller';
import { KnowledgeImportService } from './knowledge-import.service';
import { WorkbookParser } from './parsers/workbook.parser';
import { KnowledgeImportValidator } from './validators/knowledge-import.validator';
import { KnowledgeImportPreviewService } from './preview/knowledge-import-preview.service';

@Module({
  controllers: [KnowledgeImportController],

  providers: [KnowledgeImportService, WorkbookParser, KnowledgeImportValidator, KnowledgeImportPreviewService],
})
export class KnowledgeImportModule {}
