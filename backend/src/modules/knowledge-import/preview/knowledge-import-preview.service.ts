import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  ImportBatchStatus,
  ImportEntityType,
  ImportMode,
  ImportOperation,
  ImportRecordStatus,
  MediaStatus,
  MediaType,
  Prisma,
  ReviewStatus,
} from '../../../generated/prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { ImportStorageService } from '../storage/import-storage.service';

import {
  ParsedKnowledgeDocumentSection,
  ParsedKnowledgeImage,
  ParsedKnowledgeItem,
  ParsedReviewIssue,
  WorkbookParseResult,
} from '../types/knowledge-import.types';

@Injectable()
export class KnowledgeImportPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importStorage: ImportStorageService,
  ) {}

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
      const originalFileUrl = await this.importStorage.saveSourceWorkbook(batch.id, file);

      await this.prisma.knowledgeImportBatch.update({
        where: {
          id: batch.id,
        },

        data: {
          originalFileUrl,
        },
      });

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
        currentPublishedVersion: {
          include: {
            sources: {
              include: {
                source: true,
              },
            },
            media: {
              include: {
                media: true,
              },
            },
          },
        },
      },
    });

    const existingMap = new Map(existingItems.map((item) => [item.code, item]));

    return items.map((item) => {
      const existing = existingMap.get(item.knowledgeCode);

      const afterData = this.normalizeKnowledgeItem(item);

      const beforeData = existing?.currentPublishedVersion
        ? this.normalizeExistingKnowledgeItem(existing.code, existing.currentPublishedVersion)
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
    const grouped = new Map<string, ParsedKnowledgeDocumentSection[]>();

    for (const section of sections) {
      const documentSections = grouped.get(section.documentCode) ?? [];

      documentSections.push(section);
      grouped.set(section.documentCode, documentSections);
    }

    const documentCodes = [...grouped.keys()];

    const existingDocuments = await this.prisma.knowledgeDocument.findMany({
      where: {
        code: {
          in: documentCodes,
        },
      },

      include: {
        currentPublishedVersion: {
          include: {
            sources: {
              include: {
                source: true,
              },
            },
            media: {
              include: {
                media: true,
              },
            },
          },
        },
      },
    });

    const existingMap = new Map(existingDocuments.map((document) => [document.code, document]));

    return [...grouped.entries()].map(([documentCode, documentSections]) => {
      const existing = existingMap.get(documentCode);

      const afterData = this.normalizeKnowledgeDocument(documentCode, documentSections);

      const beforeData = existing?.currentPublishedVersion
        ? this.normalizeExistingKnowledgeDocument(existing.code, existing.currentPublishedVersion)
        : null;

      const firstSection = documentSections[0];

      return {
        batchId,

        entityType: ImportEntityType.KNOWLEDGE_DOCUMENT,

        entityKey: documentCode,

        proposedOperation: this.detectOperation(beforeData, afterData),

        status: ImportRecordStatus.PENDING,

        sourceSheet: firstSection.sourceSheet,

        sourceRow: firstSection.sourceRow,

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
            sections: {
              include: {
                sources: {
                  include: {
                    source: true,
                  },
                },
                media: {
                  include: {
                    media: true,
                  },
                },
              },
            },
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
          sourceSheet: string | null;
          sourceRow: number | null;
          sources: Array<{
            source: {
              url: string | null;
            };
          }>;
          media: Array<{
            sortOrder: number;
            media: {
              mediaCode: string;
            };
          }>;
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

            sourceSheet: section.sourceSheet,

            sourceRow: section.sourceRow,

            sources: section.sources,

            media: section.media,
          },
        });
      }
    }

    const sectionSortOrders = new Map<string, number>();

    return sections.map((section) => {
      const entityKey = `${section.documentCode}:${section.sectionCode}`;

      const existing = sectionMap.get(entityKey);

      const sortOrder = sectionSortOrders.get(section.documentCode) ?? 0;

      sectionSortOrders.set(section.documentCode, sortOrder + 1);

      const afterData = this.normalizeKnowledgeDocumentSection(section, sortOrder);

      const beforeData = existing
        ? this.normalizeExistingKnowledgeDocumentSection(existing.documentCode, existing.section)
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

      const afterData = this.normalizeKnowledgeMedia(image);

      const beforeData = existing
        ? this.normalizeExistingKnowledgeMedia(existing)
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

      include: {
        items: {
          include: {
            knowledgeItem: true,
          },
        },
      },
    });

    const existingMap = new Map(existing.map((issue) => [issue.issueCode, issue]));

    return issues.map((issue) => {
      const current = existingMap.get(issue.issueId);

      const afterData = this.normalizeReviewIssue(issue);

      const beforeData = current
        ? this.normalizeExistingReviewIssue(current)
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

      requiredFields: this.normalizeJsonValue(item.requiredFields),

      operatorTaskType: item.operatorTaskType ?? null,

      operatorInstruction: item.operatorInstruction ?? null,

      successResponseTemplate: item.successResponseTemplate ?? null,

      failureResponseTemplate: item.failureResponseTemplate ?? null,

      acknowledgementMessage: item.acknowledgementMessage ?? null,

      humanContactMessage: item.humanContactMessage ?? null,

      sourceUrls: this.normalizeSourceUrls(item.sourceUrls),

      imageIds: this.normalizeParsedImageIds(item.imageIds),

      sourceSheet: item.sourceSheet ?? null,

      sourceRow: item.sourceRow ?? null,
    };
  }

  private normalizeExistingKnowledgeItem(code: string, version: {
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
    sourceSheet: string | null;
    sourceRow: number | null;
    sources: Array<{
      source: {
        url: string | null;
      };
    }>;
    media: Array<{
      sortOrder: number;
      media: {
        mediaCode: string;
      };
    }>;
  }) {
    return {
      code,

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

      requiredFields: this.normalizeJsonValue(version.requiredFields),

      operatorTaskType: version.operatorTaskType,

      operatorInstruction: version.operatorInstruction,

      successResponseTemplate: version.successResponseTemplate,

      failureResponseTemplate: version.failureResponseTemplate,

      acknowledgementMessage: version.acknowledgementMessage,

      humanContactMessage: version.humanContactMessage,

      sourceUrls: this.normalizeSourceUrls(version.sources.map((link) => link.source.url)),

      imageIds: this.normalizeExistingImageIds(version.media),

      sourceSheet: version.sourceSheet,

      sourceRow: version.sourceRow,
    };
  }

  private normalizeKnowledgeDocument(documentCode: string, sections: ParsedKnowledgeDocumentSection[]) {
    const firstSection = sections[0];

    return {
      code: documentCode,

      title: firstSection.documentTitle,

      category: firstSection.category,

      audience: firstSection.audience,

      sourceUrls: this.normalizeSourceUrls(sections.flatMap((section) => section.sourceUrls)),

      imageIds: this.normalizeParsedImageIds(sections.flatMap((section) => section.imageIds)),

      sourceSheet: firstSection.sourceSheet ?? null,

      sourceRow: firstSection.sourceRow ?? null,
    };
  }

  private normalizeExistingKnowledgeDocument(code: string, version: {
    title: string;
    category: string;
    audience: unknown;
    sourceSheet: string | null;
    sourceRow: number | null;
    sources: Array<{
      source: {
        url: string | null;
      };
    }>;
    media: Array<{
      sortOrder: number;
      media: {
        mediaCode: string;
      };
    }>;
  }) {
    return {
      code,

      title: version.title,

      category: version.category,

      audience: version.audience,

      sourceUrls: this.normalizeSourceUrls(version.sources.map((link) => link.source.url)),

      imageIds: this.normalizeExistingImageIds(version.media),

      sourceSheet: version.sourceSheet,

      sourceRow: version.sourceRow,
    };
  }

  private normalizeKnowledgeDocumentSection(section: ParsedKnowledgeDocumentSection, sortOrder: number) {
    return {
      documentCode: section.documentCode,

      sectionCode: section.sectionCode,

      sectionTitle: section.sectionTitle,

      content: section.content,

      keywords: section.keywords,

      sortOrder,

      sourceUrls: this.normalizeSourceUrls(section.sourceUrls),

      imageIds: this.normalizeParsedImageIds(section.imageIds),

      sourceSheet: section.sourceSheet ?? null,

      sourceRow: section.sourceRow ?? null,
    };
  }

  private normalizeExistingKnowledgeDocumentSection(documentCode: string, section: {
    sectionCode: string;
    sectionTitle: string;
    content: string;
    keywords: string[];
    sortOrder: number;
    sourceSheet: string | null;
    sourceRow: number | null;
    sources: Array<{
      source: {
        url: string | null;
      };
    }>;
    media: Array<{
      sortOrder: number;
      media: {
        mediaCode: string;
      };
    }>;
  }) {
    return {
      documentCode,

      sectionCode: section.sectionCode,

      sectionTitle: section.sectionTitle,

      content: section.content,

      keywords: section.keywords,

      sortOrder: section.sortOrder,

      sourceUrls: this.normalizeSourceUrls(section.sources.map((link) => link.source.url)),

      imageIds: this.normalizeExistingImageIds(section.media),

      sourceSheet: section.sourceSheet,

      sourceRow: section.sourceRow,
    };
  }

  private normalizeKnowledgeMedia(image: ParsedKnowledgeImage) {
    return {
      mediaCode: image.imageId,

      type: MediaType.IMAGE,

      description: image.description ?? null,

      checksum: image.buffer ? createHash('sha256').update(image.buffer).digest('hex') : null,

      originalFilename: image.extension ? `${image.imageId}.${image.extension}` : image.imageId,

      sourceSheet: image.sourceSheet ?? null,

      sourceAnchor: image.sourceAnchor ?? null,

      sourceRow: image.sourceRow ?? null,

      status: image.status === 'NEEDS_REVIEW' ? MediaStatus.NEEDS_REVIEW : MediaStatus.READY,
    };
  }

  private normalizeExistingKnowledgeMedia(media: {
    mediaCode: string;
    type: unknown;
    description: string | null;
    checksum: string | null;
    originalFilename: string | null;
    sourceSheet: string | null;
    sourceAnchor: string | null;
    sourceRow: number | null;
    status: unknown;
  }) {
    return {
      mediaCode: media.mediaCode,

      type: media.type,

      description: media.description,

      checksum: media.checksum,

      originalFilename: media.originalFilename,

      sourceSheet: media.sourceSheet,

      sourceAnchor: media.sourceAnchor,

      sourceRow: media.sourceRow,

      status: media.status,
    };
  }

  private normalizeReviewIssue(issue: ParsedReviewIssue) {
    return {
      issueCode: issue.issueId,

      knowledgeCodes: issue.knowledgeCode ? [issue.knowledgeCode] : [],

      issueType: issue.issueType,

      originalContent: issue.originalContent ?? null,

      detectedProblem: issue.detectedProblem,

      suggestedAction: issue.suggestedAction ?? null,

      severity: issue.severity,

      status: this.normalizeReviewStatus(issue.reviewStatus),

      sourceSheet: issue.sourceSheet ?? null,

      sourceRow: issue.sourceRow ?? null,
    };
  }

  private normalizeExistingReviewIssue(issue: {
    issueCode: string;
    issueType: string;
    originalContent: string | null;
    detectedProblem: string;
    suggestedAction: string | null;
    severity: unknown;
    status: unknown;
    sourceSheet: string | null;
    sourceRow: number | null;
    items: Array<{
      knowledgeItem: {
        code: string;
      };
    }>;
  }) {
    return {
      issueCode: issue.issueCode,

      knowledgeCodes: issue.items.map((link) => link.knowledgeItem.code).sort(),

      issueType: issue.issueType,

      originalContent: issue.originalContent,

      detectedProblem: issue.detectedProblem,

      suggestedAction: issue.suggestedAction,

      severity: issue.severity,

      status: issue.status,

      sourceSheet: issue.sourceSheet,

      sourceRow: issue.sourceRow,
    };
  }

  private normalizeSourceUrls(urls: Array<string | null | undefined>) {
    return [...new Set(urls.filter((url): url is string => url !== null && url !== undefined))].sort();
  }

  private normalizeParsedImageIds(imageIds: string[]) {
    return [...new Set(imageIds)];
  }

  private normalizeExistingImageIds(links: Array<{
    sortOrder: number;
    media: {
      mediaCode: string;
    };
  }>) {
    return [...links]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.media.mediaCode.localeCompare(right.media.mediaCode))
      .map((link) => link.media.mediaCode);
  }

  private normalizeReviewStatus(value: string): ReviewStatus {
    if (value === ReviewStatus.RESOLVED) {
      return ReviewStatus.RESOLVED;
    }

    if (value === ReviewStatus.IGNORED) {
      return ReviewStatus.IGNORED;
    }

    return ReviewStatus.PENDING;
  }

  private normalizeJsonValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeJsonValue(item));
    }

    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = this.normalizeJsonValue((value as Record<string, unknown>)[key]);

        return result;
      }, {});
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
    return JSON.stringify(this.normalizeJsonValue(value)) ?? 'undefined';
  }
}
