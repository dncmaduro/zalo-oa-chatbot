import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { UploadApiResponse } from 'cloudinary';

import {
  ImportBatchStatus,
  ImportEntityType,
  ImportOperation,
  ImportRecordStatus,
  KnowledgeVersionStatus,
  MediaStatus,
  MediaType,
  Prisma,
  ReviewStatus,
} from '../../../generated/prisma/client';
import { CloudinaryService } from '../../../media-storage/cloudinary.service';
import { PrismaService } from '../../../prisma/prisma.service';

import { WorkbookParser } from '../parsers/workbook.parser';
import { ImportStorageService } from '../storage/import-storage.service';
import {
  ParsedKnowledgeDocumentSection,
  ParsedKnowledgeImage,
  ParsedKnowledgeItem,
  ParsedReviewIssue,
  WorkbookParseResult,
} from '../types/knowledge-import.types';
import { KnowledgeImportValidator } from '../validators/knowledge-import.validator';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class KnowledgeImportApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workbookParser: WorkbookParser,
    private readonly validator: KnowledgeImportValidator,
    private readonly importStorage: ImportStorageService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async apply(batchId: string) {
    const batch = await this.prisma.knowledgeImportBatch.findUnique({
      where: {
        id: batchId,
      },
    });

    if (!batch) {
      throw new NotFoundException(`Knowledge import batch ${batchId} was not found`);
    }

    if (batch.status !== ImportBatchStatus.PREVIEW_READY) {
      throw new ConflictException(`Knowledge import batch ${batchId} cannot be applied from status ${batch.status}`);
    }

    const sourceWorkbookPath = batch.originalFileUrl ?? this.importStorage.getSourceWorkbookPath(batch.id);
    const sourceWorkbook = await this.readSourceWorkbook(sourceWorkbookPath);
    const sourceHash = createHash('sha256').update(sourceWorkbook).digest('hex');

    if (sourceHash !== batch.fileHash) {
      throw new UnprocessableEntityException('Persisted source workbook checksum does not match the preview batch');
    }

    const parsed = await this.workbookParser.parse(sourceWorkbook);
    const validation = this.validator.validate(parsed);

    if (validation.errors.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Persisted source workbook is no longer valid',
        errors: validation.errors,
      });
    }

    const transition = await this.prisma.knowledgeImportBatch.updateMany({
      where: {
        id: batch.id,
        status: ImportBatchStatus.PREVIEW_READY,
      },
      data: {
        status: ImportBatchStatus.APPLYING,
      },
    });

    if (transition.count !== 1) {
      throw new ConflictException(`Knowledge import batch ${batchId} is already being applied`);
    }

    try {
      const records = await this.prisma.knowledgeImportRecord.findMany({
        where: {
          batchId: batch.id,
        },
      });
      const operations = this.buildOperationMap(records);
      const uploads = await this.uploadChangedMedia(parsed.images, operations);

      await this.prisma.$transaction(async (tx) => {
        const itemVersions = await this.applyKnowledgeItems(tx, parsed.knowledgeItems, operations);
        const documentResult = await this.applyKnowledgeDocuments(tx, parsed.documentSections, operations);
        const mediaIds = await this.applyMedia(tx, parsed.images, operations, uploads);

        await this.createMediaMappings(
          tx,
          parsed,
          itemVersions,
          documentResult.documentVersions,
          documentResult.sections,
          mediaIds,
        );

        await this.applyReviewIssues(tx, batch.id, parsed.reviewIssues, operations);
        await this.markRecordsApplied(tx, records);

        await tx.knowledgeImportBatch.update({
          where: {
            id: batch.id,
          },
          data: {
            status: ImportBatchStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      });

      return {
        batchId: batch.id,
        status: ImportBatchStatus.COMPLETED,
        counts: this.countOperations(records),
      };
    } catch (error) {
      await this.prisma.knowledgeImportBatch.updateMany({
        where: {
          id: batch.id,
          status: ImportBatchStatus.APPLYING,
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

  private async readSourceWorkbook(sourceWorkbookPath: string): Promise<Buffer> {
    try {
      return await readFile(sourceWorkbookPath);
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        throw new NotFoundException('Persisted source workbook was not found');
      }

      throw error;
    }
  }

  private isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
  }

  private buildOperationMap(
    records: Array<{
      entityType: ImportEntityType;
      entityKey: string;
      proposedOperation: ImportOperation;
    }>,
  ) {
    const operations = new Map<string, ImportOperation>();

    for (const record of records) {
      const key = this.operationKey(record.entityType, record.entityKey);

      if (operations.has(key)) {
        throw new Error(`Duplicate import record for ${record.entityType}:${record.entityKey}`);
      }

      if (
        record.proposedOperation !== ImportOperation.CREATE &&
        record.proposedOperation !== ImportOperation.UPDATE &&
        record.proposedOperation !== ImportOperation.NO_CHANGE
      ) {
        throw new Error(
          `Unsupported import operation ${record.proposedOperation} for ${record.entityType}:${record.entityKey}`,
        );
      }

      operations.set(key, record.proposedOperation);
    }

    return operations;
  }

  private operationKey(entityType: ImportEntityType, entityKey: string): string {
    return `${entityType}:${entityKey}`;
  }

  private getOperation(
    operations: Map<string, ImportOperation>,
    entityType: ImportEntityType,
    entityKey: string,
  ): ImportOperation {
    const operation = operations.get(this.operationKey(entityType, entityKey));

    if (!operation) {
      throw new Error(`Missing preview record for ${entityType}:${entityKey}`);
    }

    return operation;
  }

  private async uploadChangedMedia(images: ParsedKnowledgeImage[], operations: Map<string, ImportOperation>) {
    const uploads = new Map<string, UploadApiResponse>();

    for (const image of images) {
      const operation = this.getOperation(operations, ImportEntityType.MEDIA, image.imageId);

      if (operation === ImportOperation.NO_CHANGE) {
        continue;
      }

      if (!image.buffer) {
        throw new Error(`Image ${image.imageId} has no embedded buffer to upload`);
      }

      const targetCode = image.knowledgeCode ?? image.documentCode ?? 'shared';
      const upload = await this.cloudinary.uploadKnowledgeImageBuffer(image.buffer, targetCode, image.imageId);

      uploads.set(image.imageId, upload);
    }

    return uploads;
  }

  private async applyKnowledgeItems(
    tx: TransactionClient,
    items: ParsedKnowledgeItem[],
    operations: Map<string, ImportOperation>,
  ) {
    const versions = new Map<string, string>();

    for (const item of items) {
      const operation = this.getOperation(operations, ImportEntityType.KNOWLEDGE_ITEM, item.knowledgeCode);

      if (operation === ImportOperation.NO_CHANGE) {
        continue;
      }

      let knowledgeItemId: string;

      if (operation === ImportOperation.CREATE) {
        const knowledgeItem = await tx.knowledgeItem.create({
          data: {
            code: item.knowledgeCode,
          },
        });

        knowledgeItemId = knowledgeItem.id;
      } else {
        const knowledgeItem = await tx.knowledgeItem.findUnique({
          where: {
            code: item.knowledgeCode,
          },
        });

        if (!knowledgeItem) {
          throw new Error(`Knowledge item ${item.knowledgeCode} no longer exists`);
        }

        knowledgeItemId = knowledgeItem.id;

        await tx.knowledgeItemVersion.updateMany({
          where: {
            knowledgeItemId,
            status: KnowledgeVersionStatus.PUBLISHED,
          },
          data: {
            status: KnowledgeVersionStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        });
      }

      const nextVersionNumber = await this.getNextItemVersionNumber(tx, knowledgeItemId);
      const version = await tx.knowledgeItemVersion.create({
        data: {
          knowledgeItemId,
          versionNumber: nextVersionNumber,
          title: item.title,
          category: item.category,
          subCategory: item.subCategory,
          audience: item.audience,
          resolutionType: item.resolutionType,
          userScenarios: item.userScenarios,
          exampleQuestions: item.exampleQuestions,
          keywords: item.keywords,
          knowledgeContent: item.knowledgeContent,
          initialResponse: item.initialResponse,
          requiredFields: item.requiredFields,
          operatorTaskType: item.operatorTaskType,
          operatorInstruction: item.operatorInstruction,
          successResponseTemplate: item.successResponseTemplate,
          failureResponseTemplate: item.failureResponseTemplate,
          acknowledgementMessage: item.acknowledgementMessage,
          humanContactMessage: item.humanContactMessage,
          status: KnowledgeVersionStatus.PUBLISHED,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
          publishedAt: new Date(),
        },
      });

      await tx.knowledgeItem.update({
        where: {
          id: knowledgeItemId,
        },
        data: {
          currentPublishedVersionId: version.id,
        },
      });

      await this.attachItemSources(tx, version.id, item.sourceUrls);
      versions.set(item.knowledgeCode, version.id);
    }

    return versions;
  }

  private async getNextItemVersionNumber(tx: TransactionClient, knowledgeItemId: string) {
    const latest = await tx.knowledgeItemVersion.aggregate({
      where: {
        knowledgeItemId,
      },
      _max: {
        versionNumber: true,
      },
    });

    return (latest._max.versionNumber ?? 0) + 1;
  }

  private async applyKnowledgeDocuments(
    tx: TransactionClient,
    parsedSections: ParsedKnowledgeDocumentSection[],
    operations: Map<string, ImportOperation>,
  ) {
    const sectionsByDocument = new Map<string, ParsedKnowledgeDocumentSection[]>();

    for (const section of parsedSections) {
      const sections = sectionsByDocument.get(section.documentCode) ?? [];
      sections.push(section);
      sectionsByDocument.set(section.documentCode, sections);
    }

    const documentVersions = new Map<string, string>();
    const sections = new Map<string, string>();

    for (const [documentCode, documentSections] of sectionsByDocument) {
      const documentOperation = this.getOperation(operations, ImportEntityType.KNOWLEDGE_DOCUMENT, documentCode);
      const sectionOperations = documentSections.map((section) =>
        this.getOperation(operations, ImportEntityType.DOCUMENT_SECTION, `${documentCode}:${section.sectionCode}`),
      );
      const needsVersion =
        documentOperation === ImportOperation.CREATE ||
        documentOperation === ImportOperation.UPDATE ||
        sectionOperations.some((operation) => operation !== ImportOperation.NO_CHANGE);

      if (!needsVersion) {
        continue;
      }

      const documentMetadata = documentSections[0];
      let knowledgeDocumentId: string;

      if (documentOperation === ImportOperation.CREATE) {
        const document = await tx.knowledgeDocument.create({
          data: {
            code: documentCode,
          },
        });

        knowledgeDocumentId = document.id;
      } else {
        const document = await tx.knowledgeDocument.findUnique({
          where: {
            code: documentCode,
          },
        });

        if (!document) {
          throw new Error(`Knowledge document ${documentCode} no longer exists`);
        }

        knowledgeDocumentId = document.id;

        await tx.knowledgeDocumentVersion.updateMany({
          where: {
            knowledgeDocumentId,
            status: KnowledgeVersionStatus.PUBLISHED,
          },
          data: {
            status: KnowledgeVersionStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        });
      }

      const nextVersionNumber = await this.getNextDocumentVersionNumber(tx, knowledgeDocumentId);
      const version = await tx.knowledgeDocumentVersion.create({
        data: {
          knowledgeDocumentId,
          versionNumber: nextVersionNumber,
          title: documentMetadata.documentTitle,
          category: documentMetadata.category,
          audience: documentMetadata.audience,
          status: KnowledgeVersionStatus.PUBLISHED,
          sourceSheet: documentMetadata.sourceSheet,
          sourceRow: documentMetadata.sourceRow,
          publishedAt: new Date(),
        },
      });

      await tx.knowledgeDocument.update({
        where: {
          id: knowledgeDocumentId,
        },
        data: {
          currentPublishedVersionId: version.id,
        },
      });

      await this.attachDocumentSources(
        tx,
        version.id,
        documentSections.flatMap((section) => section.sourceUrls),
      );

      for (const [sortOrder, section] of documentSections.entries()) {
        const createdSection = await tx.knowledgeDocumentSection.create({
          data: {
            documentVersionId: version.id,
            sectionCode: section.sectionCode,
            sectionTitle: section.sectionTitle,
            content: section.content,
            keywords: section.keywords,
            sortOrder,
            sourceSheet: section.sourceSheet,
            sourceRow: section.sourceRow,
          },
        });

        await this.attachSectionSources(tx, createdSection.id, section.sourceUrls);
        sections.set(`${documentCode}:${section.sectionCode}`, createdSection.id);
      }

      documentVersions.set(documentCode, version.id);
    }

    return {
      documentVersions,
      sections,
    };
  }

  private async getNextDocumentVersionNumber(tx: TransactionClient, knowledgeDocumentId: string) {
    const latest = await tx.knowledgeDocumentVersion.aggregate({
      where: {
        knowledgeDocumentId,
      },
      _max: {
        versionNumber: true,
      },
    });

    return (latest._max.versionNumber ?? 0) + 1;
  }

  private async applyMedia(
    tx: TransactionClient,
    images: ParsedKnowledgeImage[],
    operations: Map<string, ImportOperation>,
    uploads: Map<string, UploadApiResponse>,
  ) {
    const mediaIds = new Map<string, string>();

    for (const image of images) {
      const operation = this.getOperation(operations, ImportEntityType.MEDIA, image.imageId);

      if (operation === ImportOperation.NO_CHANGE) {
        const media = await tx.knowledgeMedia.findUnique({
          where: {
            mediaCode: image.imageId,
          },
        });

        if (!media) {
          throw new Error(`Knowledge media ${image.imageId} no longer exists`);
        }

        mediaIds.set(image.imageId, media.id);
        continue;
      }

      const upload = uploads.get(image.imageId);

      if (!upload) {
        throw new Error(`Missing Cloudinary upload result for ${image.imageId}`);
      }

      const data = {
        type: MediaType.IMAGE,
        cloudinaryPublicId: upload.public_id,
        cloudinaryResourceType: upload.resource_type,
        cloudinaryFormat: upload.format,
        secureUrl: upload.secure_url,
        width: upload.width,
        height: upload.height,
        bytes: BigInt(upload.bytes),
        originalFilename: image.extension ? `${image.imageId}.${image.extension}` : image.imageId,
        checksum: image.buffer ? createHash('sha256').update(image.buffer).digest('hex') : null,
        description: image.description,
        sourceSheet: image.sourceSheet,
        sourceAnchor: image.sourceAnchor,
        sourceRow: image.sourceRow,
        status: image.status === 'NEEDS_REVIEW' ? MediaStatus.NEEDS_REVIEW : MediaStatus.READY,
      };

      if (operation === ImportOperation.CREATE) {
        const media = await tx.knowledgeMedia.create({
          data: {
            mediaCode: image.imageId,
            ...data,
          },
        });

        mediaIds.set(image.imageId, media.id);
      } else {
        const media = await tx.knowledgeMedia.update({
          where: {
            mediaCode: image.imageId,
          },
          data,
        });

        mediaIds.set(image.imageId, media.id);
      }
    }

    return mediaIds;
  }

  private async createMediaMappings(
    tx: TransactionClient,
    parsed: WorkbookParseResult,
    itemVersions: Map<string, string>,
    documentVersions: Map<string, string>,
    sections: Map<string, string>,
    mediaIds: Map<string, string>,
  ) {
    for (const item of parsed.knowledgeItems) {
      const itemVersionId = itemVersions.get(item.knowledgeCode);

      if (!itemVersionId) {
        continue;
      }

      for (const [sortOrder, imageId] of this.uniqueImageIds(item.imageIds).entries()) {
        await tx.knowledgeItemVersionMedia.create({
          data: {
            knowledgeItemVersionId: itemVersionId,
            mediaId: this.getMediaId(mediaIds, imageId),
            sortOrder,
          },
        });
      }
    }

    const sectionsByDocument = new Map<string, ParsedKnowledgeDocumentSection[]>();

    for (const section of parsed.documentSections) {
      const documentSections = sectionsByDocument.get(section.documentCode) ?? [];
      documentSections.push(section);
      sectionsByDocument.set(section.documentCode, documentSections);

      const sectionId = sections.get(`${section.documentCode}:${section.sectionCode}`);

      if (sectionId) {
        for (const [sortOrder, imageId] of this.uniqueImageIds(section.imageIds).entries()) {
          await tx.knowledgeSectionMedia.create({
            data: {
              sectionId,
              mediaId: this.getMediaId(mediaIds, imageId),
              sortOrder,
            },
          });
        }
      }
    }

    for (const [documentCode, documentSections] of sectionsByDocument) {
      const documentVersionId = documentVersions.get(documentCode);

      if (!documentVersionId) {
        continue;
      }

      const imageIds = this.uniqueImageIds(documentSections.flatMap((section) => section.imageIds));

      for (const [sortOrder, imageId] of imageIds.entries()) {
        await tx.knowledgeDocumentVersionMedia.create({
          data: {
            documentVersionId,
            mediaId: this.getMediaId(mediaIds, imageId),
            sortOrder,
          },
        });
      }
    }
  }

  private uniqueImageIds(imageIds: string[]) {
    return [...new Set(imageIds)];
  }

  private getMediaId(mediaIds: Map<string, string>, imageId: string) {
    const mediaId = mediaIds.get(imageId);

    if (!mediaId) {
      throw new Error(`No KnowledgeMedia exists for image ${imageId}`);
    }

    return mediaId;
  }

  private async attachItemSources(tx: TransactionClient, itemVersionId: string, urls: string[]) {
    for (const sourceId of await this.resolveSourceIds(tx, urls)) {
      await tx.knowledgeItemVersionSource.create({
        data: {
          knowledgeItemVersionId: itemVersionId,
          sourceId,
        },
      });
    }
  }

  private async attachDocumentSources(tx: TransactionClient, documentVersionId: string, urls: string[]) {
    for (const sourceId of await this.resolveSourceIds(tx, urls)) {
      await tx.knowledgeDocumentVersionSource.create({
        data: {
          documentVersionId,
          sourceId,
        },
      });
    }
  }

  private async attachSectionSources(tx: TransactionClient, sectionId: string, urls: string[]) {
    for (const sourceId of await this.resolveSourceIds(tx, urls)) {
      await tx.knowledgeSectionSource.create({
        data: {
          sectionId,
          sourceId,
        },
      });
    }
  }

  private async resolveSourceIds(tx: TransactionClient, urls: string[]) {
    const sourceIds: string[] = [];

    for (const url of new Set(urls)) {
      const existing = await tx.knowledgeSource.findFirst({
        where: {
          url,
        },
      });

      if (existing) {
        sourceIds.push(existing.id);
        continue;
      }

      const source = await tx.knowledgeSource.create({
        data: {
          url,
        },
      });

      sourceIds.push(source.id);
    }

    return sourceIds;
  }

  private async applyReviewIssues(
    tx: TransactionClient,
    batchId: string,
    issues: ParsedReviewIssue[],
    operations: Map<string, ImportOperation>,
  ) {
    for (const issue of issues) {
      const operation = this.getOperation(operations, ImportEntityType.REVIEW_ISSUE, issue.issueId);

      if (operation === ImportOperation.NO_CHANGE) {
        continue;
      }

      const data = {
        importBatchId: batchId,
        sourceSheet: issue.sourceSheet,
        sourceRow: issue.sourceRow,
        issueType: issue.issueType,
        originalContent: issue.originalContent,
        detectedProblem: issue.detectedProblem,
        suggestedAction: issue.suggestedAction,
        severity: issue.severity,
        status: this.toReviewStatus(issue.reviewStatus),
      };

      let persistedIssue: { id: string };

      if (operation === ImportOperation.CREATE) {
        persistedIssue = await tx.knowledgeReviewIssue.create({
          data: {
            issueCode: issue.issueId,
            ...data,
          },
        });
      } else {
        persistedIssue = await tx.knowledgeReviewIssue.update({
          where: {
            issueCode: issue.issueId,
          },
          data,
        });
      }

      if (issue.knowledgeCode) {
        const item = await tx.knowledgeItem.findUnique({
          where: {
            code: issue.knowledgeCode,
          },
        });

        if (!item) {
          throw new Error(`Review issue ${issue.issueId} references missing knowledge item ${issue.knowledgeCode}`);
        }

        await tx.knowledgeReviewIssueItem.upsert({
          where: {
            issueId_knowledgeItemId: {
              issueId: persistedIssue.id,
              knowledgeItemId: item.id,
            },
          },
          create: {
            issueId: persistedIssue.id,
            knowledgeItemId: item.id,
          },
          update: {},
        });
      }
    }
  }

  private toReviewStatus(value: string): ReviewStatus {
    if (value === ReviewStatus.RESOLVED) {
      return ReviewStatus.RESOLVED;
    }

    if (value === ReviewStatus.IGNORED) {
      return ReviewStatus.IGNORED;
    }

    return ReviewStatus.PENDING;
  }

  private async markRecordsApplied(
    tx: TransactionClient,
    records: Array<{
      id: string;
      proposedOperation: ImportOperation;
    }>,
  ) {
    const appliedIds = records
      .filter((record) => record.proposedOperation !== ImportOperation.NO_CHANGE)
      .map((record) => record.id);
    const skippedIds = records
      .filter((record) => record.proposedOperation === ImportOperation.NO_CHANGE)
      .map((record) => record.id);
    const appliedAt = new Date();

    if (appliedIds.length > 0) {
      await tx.knowledgeImportRecord.updateMany({
        where: {
          id: {
            in: appliedIds,
          },
        },
        data: {
          status: ImportRecordStatus.APPLIED,
          appliedAt,
        },
      });
    }

    if (skippedIds.length > 0) {
      await tx.knowledgeImportRecord.updateMany({
        where: {
          id: {
            in: skippedIds,
          },
        },
        data: {
          status: ImportRecordStatus.SKIPPED,
          appliedAt,
        },
      });
    }
  }

  private countOperations(records: Array<{ proposedOperation: ImportOperation }>) {
    return records.reduce(
      (counts, record) => {
        if (record.proposedOperation === ImportOperation.CREATE) {
          counts.created += 1;
        } else if (record.proposedOperation === ImportOperation.UPDATE) {
          counts.updated += 1;
        } else if (record.proposedOperation === ImportOperation.NO_CHANGE) {
          counts.unchanged += 1;
        }

        return counts;
      },
      {
        created: 0,
        updated: 0,
        unchanged: 0,
      },
    );
  }
}
