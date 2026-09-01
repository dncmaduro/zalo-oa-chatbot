import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import {
  ParsedKnowledgeDocumentSection,
  ParsedKnowledgeImage,
  ParsedKnowledgeItem,
  ParsedReviewIssue,
  WorkbookParseResult,
} from '../types/knowledge-import.types';

import {
  KnowledgeAudience,
  ResolutionType,
} from '../../../generated/prisma/client';

@Injectable()
export class WorkbookParser {
  async parse(buffer: Buffer): Promise<WorkbookParseResult> {
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(buffer as any);

    const warnings: string[] = [];

    const requiredSheets = [
      'KNOWLEDGE_ITEMS',
      'KNOWLEDGE_DOCUMENTS',
      'KNOWLEDGE_IMAGES',
      'REVIEW_REQUIRED',
    ];

    for (const sheetName of requiredSheets) {
      if (!workbook.getWorksheet(sheetName)) {
        warnings.push(`Missing sheet: ${sheetName}`);
      }
    }

    const knowledgeItems = this.parseKnowledgeItems(
      workbook.getWorksheet('KNOWLEDGE_ITEMS'),
    );

    const documentSections = this.parseKnowledgeDocuments(
      workbook.getWorksheet('KNOWLEDGE_DOCUMENTS'),
    );

    const images = this.parseKnowledgeImages(
      workbook,
      workbook.getWorksheet('KNOWLEDGE_IMAGES'),
      warnings,
    );

    const reviewIssues = this.parseReviewIssues(
      workbook.getWorksheet('REVIEW_REQUIRED'),
    );

    return {
      knowledgeItems,
      documentSections,
      images,
      reviewIssues,
      warnings,
    };
  }

  // ====================================================
  // KNOWLEDGE ITEMS
  // ====================================================

  private parseKnowledgeItems(
    worksheet?: ExcelJS.Worksheet,
  ): ParsedKnowledgeItem[] {
    if (!worksheet) {
      return [];
    }

    const headers = this.getHeaders(worksheet);

    const items: ParsedKnowledgeItem[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const knowledgeCode = this.getString(
        row,
        headers,
        'knowledge_code',
      );

      if (!knowledgeCode) {
        return;
      }

      items.push({
        knowledgeCode,

        title: this.getString(row, headers, 'title') ?? '',

        category: this.getString(row, headers, 'category') ?? '',

        subCategory: this.getString(
          row,
          headers,
          'sub_category',
        ),

        audience: this.parseAudience(
          this.getString(row, headers, 'audience'),
        ),

        resolutionType: this.parseResolutionType(
          this.getString(row, headers, 'resolution_type'),
        ),

        userScenarios: this.getList(
          row,
          headers,
          'user_scenarios',
        ),

        exampleQuestions: this.getList(
          row,
          headers,
          'example_questions',
        ),

        keywords: this.getList(
          row,
          headers,
          'keywords',
        ),

        knowledgeContent:
          this.getString(
            row,
            headers,
            'knowledge_content',
          ) ?? '',

        initialResponse: this.getString(
          row,
          headers,
          'initial_response',
        ),

        requiredFields: this.getList(
          row,
          headers,
          'required_fields',
        ),

        operatorTaskType: this.getString(
          row,
          headers,
          'operator_task_type',
        ),

        operatorInstruction: this.getString(
          row,
          headers,
          'operator_instruction',
        ),

        successResponseTemplate: this.getString(
          row,
          headers,
          'success_response_template',
        ),

        failureResponseTemplate: this.getString(
          row,
          headers,
          'failure_response_template',
        ),

        acknowledgementMessage: this.getString(
          row,
          headers,
          'acknowledgement_message',
        ),

        humanContactMessage: this.getString(
          row,
          headers,
          'human_contact_message',
        ),

        sourceUrls: this.getList(
          row,
          headers,
          'source_url',
        ),

        imageIds: this.getList(
          row,
          headers,
          'image_ids',
        ),

        hasImages: this.getBoolean(
          row,
          headers,
          'has_images',
        ),

        sourceSheet: this.getString(
          row,
          headers,
          'source_sheet',
        ),

        sourceRow: this.getNumber(
          row,
          headers,
          'source_row',
        ),

        status:
          (this.getString(
            row,
            headers,
            'status',
          ) as ParsedKnowledgeItem['status']) ?? 'READY',

        reviewNote: this.getString(
          row,
          headers,
          'review_note',
        ),
      });
    });

    return items;
  }

  // ====================================================
  // KNOWLEDGE DOCUMENTS
  // ====================================================

  private parseKnowledgeDocuments(
    worksheet?: ExcelJS.Worksheet,
  ): ParsedKnowledgeDocumentSection[] {
    if (!worksheet) {
      return [];
    }

    const headers = this.getHeaders(worksheet);

    const sections: ParsedKnowledgeDocumentSection[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const documentCode = this.getString(
        row,
        headers,
        'document_code',
      );

      const sectionCode = this.getString(
        row,
        headers,
        'section_code',
      );

      if (!documentCode || !sectionCode) {
        return;
      }

      sections.push({
        documentCode,

        documentTitle:
          this.getString(
            row,
            headers,
            'document_title',
          ) ?? '',

        category:
          this.getString(
            row,
            headers,
            'category',
          ) ?? '',

        sectionCode,

        sectionTitle:
          this.getString(
            row,
            headers,
            'section_title',
          ) ?? '',

        audience: this.parseAudience(
          this.getString(row, headers, 'audience'),
        ),

        content:
          this.getString(
            row,
            headers,
            'content',
          ) ?? '',

        keywords: this.getList(
          row,
          headers,
          'keywords',
        ),

        sourceUrls: this.getList(
          row,
          headers,
          'source_url',
        ),

        imageIds: this.getList(
          row,
          headers,
          'image_ids',
        ),

        hasImages: this.getBoolean(
          row,
          headers,
          'has_images',
        ),

        sourceSheet: this.getString(
          row,
          headers,
          'source_sheet',
        ),

        sourceRow: this.getNumber(
          row,
          headers,
          'source_row',
        ),

        status:
          (this.getString(
            row,
            headers,
            'status',
          ) as ParsedKnowledgeDocumentSection['status']) ??
          'READY',

        reviewNote: this.getString(
          row,
          headers,
          'review_note',
        ),
      });
    });

    return sections;
  }

  // ====================================================
  // IMAGES
  // ====================================================

  private parseKnowledgeImages(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet | undefined,
    warnings: string[],
  ): ParsedKnowledgeImage[] {
    if (!worksheet) {
      return [];
    }

    const headers = this.getHeaders(worksheet);

    const imagesByRow = new Map<
      number,
      {
        extension?: string;
        buffer?: Buffer;
      }
    >();

    /**
     * KNOWLEDGE_IMAGES có mỗi ảnh nằm cùng row với metadata.
     *
     * ExcelJS cho biết ảnh đang anchor tại đâu.
     * Ta map top-left row của ảnh → row metadata.
     */
    const worksheetImages = worksheet.getImages();

    for (const image of worksheetImages) {
      try {
        const imageModel = workbook.getImage(Number(image.imageId));

        if (!imageModel) {
          warnings.push(
            `Cannot resolve embedded image id ${image.imageId}`,
          );
          continue;
        }

        const row =
          Math.floor(image.range.tl.nativeRow) + 1;

        let buffer: Buffer | undefined;

        if ('buffer' in imageModel && imageModel.buffer) {
          buffer = Buffer.from(imageModel.buffer);
        }

        imagesByRow.set(row, {
          extension:
            'extension' in imageModel
              ? imageModel.extension
              : undefined,

          buffer,
        });
      } catch (error) {
        warnings.push(
          `Failed reading image ${image.imageId}: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    const images: ParsedKnowledgeImage[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const imageId = this.getString(
        row,
        headers,
        'image_id',
      );

      if (!imageId) {
        return;
      }

      const embeddedImage = imagesByRow.get(rowNumber);

      if (!embeddedImage) {
        warnings.push(
          `Image metadata ${imageId} exists at row ${rowNumber}, but no embedded image was mapped to this row`,
        );
      }

      const extension = embeddedImage?.extension;

      images.push({
        imageId,

        knowledgeCode: this.getString(
          row,
          headers,
          'knowledge_code',
        ),

        documentCode: this.getString(
          row,
          headers,
          'document_code',
        ),

        sectionCode: this.getString(
          row,
          headers,
          'section_code',
        ),

        imageOrder:
          this.getNumber(
            row,
            headers,
            'image_order',
          ) ?? 0,

        description: this.getString(
          row,
          headers,
          'image_description',
        ),

        sourceSheet: this.getString(
          row,
          headers,
          'source_sheet',
        ),

        sourceAnchor: this.getString(
          row,
          headers,
          'source_anchor',
        ),

        sourceRow: this.getNumber(
          row,
          headers,
          'source_row',
        ),

        status:
          (this.getString(
            row,
            headers,
            'status',
          ) as ParsedKnowledgeImage['status']) ??
          'READY',

        reviewNote: this.getString(
          row,
          headers,
          'review_note',
        ),

        extension,

        mimeType: this.getMimeType(extension),

        buffer: embeddedImage?.buffer,
      });
    });

    return images;
  }

  // ====================================================
  // REVIEW REQUIRED
  // ====================================================

  private parseReviewIssues(
    worksheet?: ExcelJS.Worksheet,
  ): ParsedReviewIssue[] {
    if (!worksheet) {
      return [];
    }

    const headers = this.getHeaders(worksheet);

    const issues: ParsedReviewIssue[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const issueId = this.getString(
        row,
        headers,
        'issue_id',
      );

      if (!issueId) {
        return;
      }

      issues.push({
        issueId,

        sourceSheet: this.getString(
          row,
          headers,
          'source_sheet',
        ),

        sourceRow: this.getNumber(
          row,
          headers,
          'source_row',
        ),

        knowledgeCode: this.getString(
          row,
          headers,
          'knowledge_code',
        ),

        issueType:
          this.getString(
            row,
            headers,
            'issue_type',
          ) ?? 'UNKNOWN',

        originalContent: this.getString(
          row,
          headers,
          'original_content',
        ),

        detectedProblem:
          this.getString(
            row,
            headers,
            'detected_problem',
          ) ?? '',

        suggestedAction: this.getString(
          row,
          headers,
          'suggested_action',
        ),

        severity:
          (this.getString(
            row,
            headers,
            'severity',
          ) as ParsedReviewIssue['severity']) ??
          'LOW',

        reviewStatus:
          this.getString(
            row,
            headers,
            'review_status',
          ) ?? 'PENDING',
      });
    });

    return issues;
  }

  // ====================================================
  // HELPERS
  // ====================================================

  private getHeaders(
    worksheet: ExcelJS.Worksheet,
  ): Map<string, number> {
    const headers = new Map<string, number>();

    const headerRow = worksheet.getRow(1);

    headerRow.eachCell((cell, columnNumber) => {
      const value = this.cellToString(cell.value);

      if (value) {
        headers.set(
          value.trim().toLowerCase(),
          columnNumber,
        );
      }
    });

    return headers;
  }

  private getCell(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    key: string,
  ): ExcelJS.Cell | undefined {
    const column = headers.get(key);

    if (!column) {
      return undefined;
    }

    return row.getCell(column);
  }

  private getString(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    key: string,
  ): string | undefined {
    const cell = this.getCell(row, headers, key);

    if (!cell) {
      return undefined;
    }

    const result = this.cellToString(cell.value);

    return result?.trim() || undefined;
  }

  private getNumber(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    key: string,
  ): number | undefined {
    const value = this.getString(
      row,
      headers,
      key,
    );

    if (!value) {
      return undefined;
    }

    const result = Number(value);

    return Number.isNaN(result)
      ? undefined
      : result;
  }

  private getBoolean(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    key: string,
  ): boolean {
    const value = this.getString(
      row,
      headers,
      key,
    )
      ?.trim()
      .toLowerCase();

    return (
      value === 'true' ||
      value === '1' ||
      value === 'yes'
    );
  }

  private getList(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    key: string,
  ): string[] {
    const value = this.getString(
      row,
      headers,
      key,
    );

    if (!value) {
      return [];
    }

    return value
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private cellToString(
    value: ExcelJS.CellValue,
  ): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }

    /**
     * Hyperlink cell
     */
    if (
      typeof value === 'object' &&
      'text' in value &&
      typeof value.text === 'string'
    ) {
      return value.text;
    }

    /**
     * Formula result
     */
    if (
      typeof value === 'object' &&
      'result' in value
    ) {
      return String(value.result ?? '');
    }

    return String(value);
  }

  private parseAudience(
    value?: string,
  ): KnowledgeAudience {
    switch (value?.toUpperCase()) {
      case 'CUSTOMER':
        return KnowledgeAudience.CUSTOMER;

      case 'OPERATOR':
        return KnowledgeAudience.OPERATOR;

      case 'ALL':
        return KnowledgeAudience.ALL;

      case 'EMPLOYEE':
      default:
        return KnowledgeAudience.EMPLOYEE;
    }
  }

  private parseResolutionType(
    value?: string,
  ): ResolutionType {
    switch (value?.toUpperCase()) {
      case 'OPERATOR_TASK':
        return ResolutionType.OPERATOR_TASK;

      case 'HUMAN_CONTACT':
        return ResolutionType.HUMAN_CONTACT;

      case 'AUTO_RESPONSE':
      default:
        return ResolutionType.AUTO_RESPONSE;
    }
  }

  private getMimeType(
    extension?: string,
  ): string | undefined {
    switch (extension?.toLowerCase()) {
      case 'png':
        return 'image/png';

      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';

      case 'gif':
        return 'image/gif';

      case 'webp':
        return 'image/webp';

      default:
        return undefined;
    }
  }
}