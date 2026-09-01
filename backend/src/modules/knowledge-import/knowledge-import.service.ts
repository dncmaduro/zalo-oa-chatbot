import { BadRequestException, Injectable } from '@nestjs/common';

import { WorkbookParser } from './parsers/workbook.parser';
import { KnowledgeImportValidator } from './validators/knowledge-import.validator';
import { KnowledgeImportPreviewService } from './preview/knowledge-import-preview.service';

@Injectable()
export class KnowledgeImportService {
  constructor(
    private readonly workbookParser: WorkbookParser,
    private readonly validator: KnowledgeImportValidator,
    private readonly previewService: KnowledgeImportPreviewService,
  ) {}

  async preview(file: Express.Multer.File) {
    // ==================================================
    // 1. VALIDATE FILE
    // ==================================================

    if (!file) {
      throw new BadRequestException('Excel file is required');
    }

    if (!file.originalname.match(/\.xlsx$/i)) {
      throw new BadRequestException('Only .xlsx files are supported');
    }

    // ==================================================
    // 2. PARSE WORKBOOK
    // ==================================================

    const parsed = await this.workbookParser.parse(file.buffer);

    // ==================================================
    // 3. VALIDATE PARSED DATA
    // ==================================================

    const validation = this.validator.validate(parsed);

    // Parser warning hiện tại là string[],
    // convert về cùng format với validator warning.
    const parserWarnings = parsed.warnings.map((message) => ({
      code: 'PARSER_WARNING',
      message,
      entityType: 'WORKBOOK' as const,
    }));

    const warnings = [...parserWarnings, ...validation.warnings];

    // ==================================================
    // 4. BUILD SUMMARY
    // ==================================================

    const documentCodes = new Set(parsed.documentSections.map((section) => section.documentCode));

    const summary = {
      knowledgeItems: parsed.knowledgeItems.length,

      documents: documentCodes.size,

      documentSections: parsed.documentSections.length,

      images: parsed.images.length,

      reviewIssues: parsed.reviewIssues.length,
    };

    // ==================================================
    // 5. IF INVALID -> STOP HERE
    //
    // Quan trọng:
    // Có error thì KHÔNG tạo import batch,
    // KHÔNG ghi preview vào DB.
    // ==================================================

    if (validation.errors.length > 0) {
      return {
        importable: false,

        batchId: null,

        status: null,

        previousBatchId: null,

        summary,

        errors: validation.errors,

        warnings,

        records: [],
      };
    }

    // ==================================================
    // 6. VALID -> PERSIST PREVIEW TO DB
    //
    // Đoạn này sẽ:
    //
    // - tính SHA256 file
    // - tạo KnowledgeImportBatch
    // - so sánh Excel với KB hiện tại
    // - tạo KnowledgeImportRecord
    // - set batch PREVIEW_READY
    //
    // VẪN CHƯA apply Knowledge thật.
    // ==================================================

    const persistedPreview = await this.previewService.createPreview(file, parsed);

    // ==================================================
    // 7. RETURN PREVIEW
    // ==================================================

    return {
      importable: true,

      batchId: persistedPreview.batchId,

      status: persistedPreview.status,

      previousBatchId: persistedPreview.previousBatchId,

      summary,

      errors: [],

      warnings,

      records: persistedPreview.records,
    };
  }
}
