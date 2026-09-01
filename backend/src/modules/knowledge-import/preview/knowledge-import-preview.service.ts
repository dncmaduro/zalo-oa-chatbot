import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  ImportBatchStatus,
  ImportEntityType,
  ImportMode,
  ImportOperation,
  ImportRecordStatus,
  Prisma,
} from '../../../generated/prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  ParsedKnowledgeDocumentSection,
  ParsedKnowledgeImage,
  ParsedKnowledgeItem,
  ParsedReviewIssue,
  WorkbookParseResult,
} from '../types/knowledge-import.types';

@Injectable()
export class KnowledgeImportPreviewService {
  constructor(private readonly prisma: PrismaService) {}

  private toJsonInput(value: unknown): Prisma.InputJsonValue {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new Error('Value cannot be serialized to JSON');
    }

    return JSON.parse(serialized) as Prisma.InputJsonValue;
  }

  private toNullableJsonInput(value: unknown) {
    /**
     * Không có beforeData nghĩa là cột DB phải là SQL NULL.
     *
     * Prisma không cho truyền JS null trực tiếp vào Json?.
     */
    if (value === null || value === undefined) {
      return Prisma.DbNull;
    }

    return this.toJsonInput(value);
  }

  async createPreview(file: Express.Multer.File, parsed: WorkbookParseResult) {
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    const previousCompleted = await this.prisma.knowledgeImportBatch.findFirst({
      where: {
        fileHash,
        status: {
          in: [ImportBatchStatus.COMPLETED, ImportBatchStatus.PREVIEW_READY],
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });

    /**
     * Không block ở đây.
     *
     * Có thể user muốn preview lại cùng file.
     * Sau này UI sẽ hiển thị previousBatchId.
     */
    const batch = await this.prisma.knowledgeImportBatch.create({
      data: {
        mode: ImportMode.BULK_UPDATE,

        filename: file.originalname,
        fileHash,

        status: ImportBatchStatus.VALIDATING,

        knowledgeItemsCount: parsed.knowledgeItems.length,

        documentsCount: new Set(parsed.documentSections.map((item) => item.documentCode)).size,

        sectionsCount: parsed.documentSections.length,

        mediaCount: parsed.images.length,

        reviewIssueCount: parsed.reviewIssues.length,
      },
    });

    try {
      const records = [
        ...(await this.buildKnowledgeItemRecords(batch.id, parsed.knowledgeItems)),

        ...(await this.buildDocumentRecords(batch.id, parsed.documentSections)),

        ...(await this.buildSectionRecords(batch.id, parsed.documentSections)),

        ...(await this.buildMediaRecords(batch.id, parsed.images)),

        ...(await this.buildReviewRecords(batch.id, parsed.reviewIssues)),
      ];

      if (records.length > 0) {
        const recordInputs: Prisma.KnowledgeImportRecordCreateManyInput[] = records.map((record) => ({
          batchId: record.batchId,

          entityType: record.entityType,

          entityKey: record.entityKey,

          proposedOperation: record.proposedOperation,

          status: record.status,

          sourceSheet: record.sourceSheet,

          sourceRow: record.sourceRow,

          beforeData: this.toNullableJsonInput(record.beforeData),

          afterData: this.toJsonInput(record.afterData),

          diff: this.toJsonInput(record.diff),
        }));

        await this.prisma.knowledgeImportRecord.createMany({
          data: recordInputs,
        });
      }

      const updatedBatch = await this.prisma.knowledgeImportBatch.update({
        where: {
          id: batch.id,
        },

        data: {
          status: ImportBatchStatus.PREVIEW_READY,

          previewReadyAt: new Date(),
        },

        include: {
          records: {
            orderBy: [
              {
                entityType: 'asc',
              },
              {
                entityKey: 'asc',
              },
            ],
          },
        },
      });

      return {
        batchId: updatedBatch.id,

        status: updatedBatch.status,

        previousBatchId: previousCompleted?.id ?? null,

        records: updatedBatch.records,
      };
    } catch (error) {
      await this.prisma.knowledgeImportBatch.update({
        where: {
          id: batch.id,
        },

        data: {
          status: ImportBatchStatus.FAILED,

          errorLog: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });

      throw error;
    }
  }

  // ====================================================
  // KNOWLEDGE ITEMS
  // ====================================================

  private async buildKnowledgeItemRecords(batchId: string, items: ParsedKnowledgeItem[]) {
    const codes = items.map((item) => item.knowledgeCode);

    const existingItems = await this.prisma.knowledgeItem.findMany({
      where: {
        code: {
          in: codes,
        },
      },

      include: {
        currentPublishedVersion: true,
      },
    });

    const existingMap = new Map(existingItems.map((item) => [item.code, item]));

    return items.map((item) => {
      const existing = existingMap.get(item.knowledgeCode);

      const afterData = this.normalizeKnowledgeItem(item);

      const beforeData = existing?.currentPublishedVersion
        ? this.normalizeExistingKnowledgeItem(existing.currentPublishedVersion)
        : null;

      const operation = this.detectOperation(beforeData, afterData);

      return {
        batchId,

        entityType: ImportEntityType.KNOWLEDGE_ITEM,

        entityKey: item.knowledgeCode,

        proposedOperation: operation,

        status: ImportRecordStatus.PENDING,

        sourceSheet: item.sourceSheet,

        sourceRow: item.sourceRow,

        beforeData,

        afterData,

        diff: this.buildDiff(beforeData, afterData),
      };
    });
  }

  // ====================================================
  // DOCUMENTS
  // ====================================================

  private async buildDocumentRecords(batchId: string, sections: ParsedKnowledgeDocumentSection[]) {
    const grouped = new Map<string, ParsedKnowledgeDocumentSection>();

    for (const section of sections) {
      if (!grouped.has(section.documentCode)) {
        grouped.set(section.documentCode, section);
      }
    }

    const documentCodes = [...grouped.keys()];

    const existingDocuments = await this.prisma.knowledgeDocument.findMany({
      where: {
        code: {
          in: documentCodes,
        },
      },

      include: {
        currentPublishedVersion: true,
      },
    });

    const existingMap = new Map(existingDocuments.map((document) => [document.code, document]));

    return [...grouped.entries()].map(([documentCode, section]) => {
      const existing = existingMap.get(documentCode);

      const afterData = {
        code: documentCode,
        title: section.documentTitle,
        category: section.category,
        audience: section.audience,
      };

      const beforeData = existing?.currentPublishedVersion
        ? {
            code: existing.code,

            title: existing.currentPublishedVersion.title,

            category: existing.currentPublishedVersion.category,

            audience: existing.currentPublishedVersion.audience,
          }
        : null;

      return {
        batchId,

        entityType: ImportEntityType.KNOWLEDGE_DOCUMENT,

        entityKey: documentCode,

        proposedOperation: this.detectOperation(beforeData, afterData),

        status: ImportRecordStatus.PENDING,

        sourceSheet: section.sourceSheet,

        sourceRow: section.sourceRow,

        beforeData,

        afterData,

        diff: this.buildDiff(beforeData, afterData),
      };
    });
  }

  // ====================================================
  // DOCUMENT SECTIONS
  // ====================================================

  private async buildSectionRecords(batchId: string, sections: ParsedKnowledgeDocumentSection[]) {
    const documentCodes = [...new Set(sections.map((section) => section.documentCode))];

    const documents = await this.prisma.knowledgeDocument.findMany({
      where: {
        code: {
          in: documentCodes,
        },
      },

      include: {
        currentPublishedVersion: {
          include: {
            sections: true,
          },
        },
      },
    });

    const sectionMap = new Map<
      string,
      {
        documentCode: string;
        section: {
          sectionCode: string;
          sectionTitle: string;
          content: string;
          keywords: string[];
          sortOrder: number;
        };
      }
    >();

    for (const document of documents) {
      const version = document.currentPublishedVersion;

      if (!version) {
        continue;
      }

      for (const section of version.sections) {
        sectionMap.set(`${document.code}:${section.sectionCode}`, {
          documentCode: document.code,

          section: {
            sectionCode: section.sectionCode,

            sectionTitle: section.sectionTitle,

            content: section.content,

            keywords: section.keywords,

            sortOrder: section.sortOrder,
          },
        });
      }
    }

    return sections.map((section, index) => {
      const entityKey = `${section.documentCode}:${section.sectionCode}`;

      const existing = sectionMap.get(entityKey);

      const afterData = {
        documentCode: section.documentCode,

        sectionCode: section.sectionCode,

        sectionTitle: section.sectionTitle,

        content: section.content,

        keywords: section.keywords,

        sortOrder: index,
      };

      const beforeData = existing
        ? {
            documentCode: existing.documentCode,

            ...existing.section,
          }
        : null;

      return {
        batchId,

        entityType: ImportEntityType.DOCUMENT_SECTION,

        entityKey,

        proposedOperation: this.detectOperation(beforeData, afterData),

        status: ImportRecordStatus.PENDING,

        sourceSheet: section.sourceSheet,

        sourceRow: section.sourceRow,

        beforeData,

        afterData,

        diff: this.buildDiff(beforeData, afterData),
      };
    });
  }

  // ====================================================
  // MEDIA
  // ====================================================

  private async buildMediaRecords(batchId: string, images: ParsedKnowledgeImage[]) {
    const mediaCodes = images.map((image) => image.imageId);

    const existingMedia = await this.prisma.knowledgeMedia.findMany({
      where: {
        mediaCode: {
          in: mediaCodes,
        },
      },
    });

    const existingMap = new Map(existingMedia.map((media) => [media.mediaCode, media]));

    return images.map((image) => {
      const existing = existingMap.get(image.imageId);

      const checksum = image.buffer ? createHash('sha256').update(image.buffer).digest('hex') : null;

      const afterData = {
        mediaCode: image.imageId,

        knowledgeCode: image.knowledgeCode ?? null,

        documentCode: image.documentCode ?? null,

        sectionCode: image.sectionCode ?? null,

        imageOrder: image.imageOrder,

        description: image.description ?? null,

        extension: image.extension ?? null,

        mimeType: image.mimeType ?? null,

        checksum,
      };

      const beforeData = existing
        ? {
            mediaCode: existing.mediaCode,

            description: existing.description,

            checksum: existing.checksum,
          }
        : null;

      return {
        batchId,

        entityType: ImportEntityType.MEDIA,

        entityKey: image.imageId,

        proposedOperation: this.detectOperation(beforeData, afterData),

        status: ImportRecordStatus.PENDING,

        sourceSheet: image.sourceSheet,

        sourceRow: image.sourceRow,

        beforeData,

        afterData,

        diff: this.buildDiff(beforeData, afterData),
      };
    });
  }

  // ====================================================
  // REVIEW ISSUES
  // ====================================================

  private async buildReviewRecords(batchId: string, issues: ParsedReviewIssue[]) {
    const issueCodes = issues.map((issue) => issue.issueId);

    const existing = await this.prisma.knowledgeReviewIssue.findMany({
      where: {
        issueCode: {
          in: issueCodes,
        },
      },
    });

    const existingMap = new Map(existing.map((issue) => [issue.issueCode, issue]));

    return issues.map((issue) => {
      const current = existingMap.get(issue.issueId);

      const afterData = {
        issueCode: issue.issueId,

        knowledgeCode: issue.knowledgeCode ?? null,

        issueType: issue.issueType,

        originalContent: issue.originalContent ?? null,

        detectedProblem: issue.detectedProblem,

        suggestedAction: issue.suggestedAction ?? null,

        severity: issue.severity,

        reviewStatus: issue.reviewStatus,
      };

      const beforeData = current
        ? {
            issueCode: current.issueCode,

            issueType: current.issueType,

            originalContent: current.originalContent,

            detectedProblem: current.detectedProblem,

            suggestedAction: current.suggestedAction,

            severity: current.severity,

            status: current.status,
          }
        : null;

      return {
        batchId,

        entityType: ImportEntityType.REVIEW_ISSUE,

        entityKey: issue.issueId,

        proposedOperation: this.detectOperation(beforeData, afterData),

        status: ImportRecordStatus.PENDING,

        sourceSheet: issue.sourceSheet,

        sourceRow: issue.sourceRow,

        beforeData,

        afterData,

        diff: this.buildDiff(beforeData, afterData),
      };
    });
  }

  // ====================================================
  // HELPERS
  // ====================================================

  private normalizeKnowledgeItem(item: ParsedKnowledgeItem) {
    return {
      code: item.knowledgeCode,

      title: item.title,

      category: item.category,

      subCategory: item.subCategory ?? null,

      audience: item.audience,

      resolutionType: item.resolutionType,

      userScenarios: item.userScenarios,

      exampleQuestions: item.exampleQuestions,

      keywords: item.keywords,

      knowledgeContent: item.knowledgeContent,

      initialResponse: item.initialResponse ?? null,

      requiredFields: item.requiredFields,

      operatorTaskType: item.operatorTaskType ?? null,

      operatorInstruction: item.operatorInstruction ?? null,

      successResponseTemplate: item.successResponseTemplate ?? null,

      failureResponseTemplate: item.failureResponseTemplate ?? null,

      acknowledgementMessage: item.acknowledgementMessage ?? null,

      humanContactMessage: item.humanContactMessage ?? null,

      sourceUrls: item.sourceUrls,

      imageIds: item.imageIds,

      status: item.status,
    };
  }

  private normalizeExistingKnowledgeItem(version: {
    title: string;
    category: string;
    subCategory: string | null;
    audience: unknown;
    resolutionType: unknown;
    userScenarios: string[];
    exampleQuestions: string[];
    keywords: string[];
    knowledgeContent: string;
    initialResponse: string | null;
    requiredFields: unknown;
    operatorTaskType: string | null;
    operatorInstruction: string | null;
    successResponseTemplate: string | null;
    failureResponseTemplate: string | null;
    acknowledgementMessage: string | null;
    humanContactMessage: string | null;
  }) {
    return {
      title: version.title,

      category: version.category,

      subCategory: version.subCategory,

      audience: version.audience,

      resolutionType: version.resolutionType,

      userScenarios: version.userScenarios,

      exampleQuestions: version.exampleQuestions,

      keywords: version.keywords,

      knowledgeContent: version.knowledgeContent,

      initialResponse: version.initialResponse,

      requiredFields: version.requiredFields,

      operatorTaskType: version.operatorTaskType,

      operatorInstruction: version.operatorInstruction,

      successResponseTemplate: version.successResponseTemplate,

      failureResponseTemplate: version.failureResponseTemplate,

      acknowledgementMessage: version.acknowledgementMessage,

      humanContactMessage: version.humanContactMessage,
    };
  }

  private detectOperation(beforeData: unknown, afterData: unknown): ImportOperation {
    if (!beforeData) {
      return ImportOperation.CREATE;
    }

    if (this.stableStringify(beforeData) === this.stableStringify(afterData)) {
      return ImportOperation.NO_CHANGE;
    }

    return ImportOperation.UPDATE;
  }

  private buildDiff(beforeData: unknown, afterData: unknown) {
    if (!beforeData) {
      return {
        type: 'CREATE',
      };
    }

    const before = beforeData as Record<string, unknown>;

    const after = afterData as Record<string, unknown>;

    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    const changes: Record<
      string,
      {
        before: unknown;
        after: unknown;
      }
    > = {};

    for (const key of keys) {
      if (this.stableStringify(before[key]) !== this.stableStringify(after[key])) {
        changes[key] = {
          before: before[key] ?? null,

          after: after[key] ?? null,
        };
      }
    }

    return {
      type: Object.keys(changes).length === 0 ? 'NO_CHANGE' : 'UPDATE',

      changes,
    };
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value.map((item) => JSON.parse(this.stableStringify(item))));
    }

    const object = value as Record<string, unknown>;

    const sorted = Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = object[key];

        return result;
      }, {});

    return JSON.stringify(sorted);
  }
}
