import { Inject, Injectable } from '@nestjs/common';

import { KnowledgeVersionStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { EmbeddingService } from './embedding.service';
import {
  KnowledgeDocumentSectionEmbeddingContentInput,
  KnowledgeEmbeddingContentService,
  KnowledgeItemEmbeddingContentInput,
} from './knowledge-embedding-content.service';

interface KnowledgeItemEmbeddingRow extends KnowledgeItemEmbeddingContentInput {
  id: string;
  embeddingModel: string | null;
  embeddingContentHash: string | null;
  hasEmbedding: boolean;
}

interface KnowledgeDocumentSectionEmbeddingRow extends KnowledgeDocumentSectionEmbeddingContentInput {
  id: string;
  embeddingModel: string | null;
  embeddingContentHash: string | null;
  hasEmbedding: boolean;
}

export interface KnowledgeEmbeddingBackfillResult {
  total: number;
  generated: number;
  skipped: number;
  failed: number;
}

export class KnowledgeEmbeddingBackfillError extends Error {
  constructor(
    message: string,
    public readonly result: KnowledgeEmbeddingBackfillResult,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = 'KnowledgeEmbeddingBackfillError';
  }
}

@Injectable()
export class KnowledgeEmbeddingBackfillService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,

    @Inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,

    @Inject(KnowledgeEmbeddingContentService)
    private readonly contentService: KnowledgeEmbeddingContentService,
  ) {}

  async backfill(): Promise<KnowledgeEmbeddingBackfillResult> {
    const model = this.embeddingService.model;
    const [itemRows, sectionRows] = await Promise.all([
      this.findCurrentPublishedKnowledgeItems(),
      this.findCurrentPublishedDocumentSections(),
    ]);
    const result: KnowledgeEmbeddingBackfillResult = {
      total: itemRows.length + sectionRows.length,
      generated: 0,
      skipped: 0,
      failed: 0,
    };
    let expectedDimension: number | undefined;

    for (const row of itemRows) {
      try {
        const outcome = await this.backfillKnowledgeItem(row, model, expectedDimension);
        expectedDimension = outcome.dimension ?? expectedDimension;
        result[outcome.status] += 1;
      } catch (error) {
        result.failed += 1;
        throw this.createBackfillError('knowledge item version', row.id, result, error);
      }
    }

    for (const row of sectionRows) {
      try {
        const outcome = await this.backfillDocumentSection(row, model, expectedDimension);
        expectedDimension = outcome.dimension ?? expectedDimension;
        result[outcome.status] += 1;
      } catch (error) {
        result.failed += 1;
        throw this.createBackfillError('knowledge document section', row.id, result, error);
      }
    }

    return result;
  }

  private async findCurrentPublishedKnowledgeItems(): Promise<KnowledgeItemEmbeddingRow[]> {
    return this.prisma.$queryRaw<KnowledgeItemEmbeddingRow[]>(Prisma.sql`
      SELECT
        kiv.id,
        kiv.title,
        kiv.category,
        kiv.sub_category AS "subCategory",
        kiv.keywords,
        kiv.example_questions AS "exampleQuestions",
        kiv.user_scenarios AS "userScenarios",
        kiv.knowledge_content AS "knowledgeContent",
        kiv.embedding_model AS "embeddingModel",
        kiv.embedding_content_hash AS "embeddingContentHash",
        (kiv.embedding IS NOT NULL) AS "hasEmbedding"
      FROM knowledge_items ki
      INNER JOIN knowledge_item_versions kiv
        ON kiv.id = ki.current_published_version_id
      WHERE kiv.status = ${KnowledgeVersionStatus.PUBLISHED}
      ORDER BY ki.code ASC, kiv.id ASC
    `);
  }

  private async findCurrentPublishedDocumentSections(): Promise<KnowledgeDocumentSectionEmbeddingRow[]> {
    return this.prisma.$queryRaw<KnowledgeDocumentSectionEmbeddingRow[]>(Prisma.sql`
      SELECT
        kds.id,
        kdv.title AS "documentTitle",
        kds.section_title AS "sectionTitle",
        kds.keywords,
        kds.content,
        kds.embedding_model AS "embeddingModel",
        kds.embedding_content_hash AS "embeddingContentHash",
        (kds.embedding IS NOT NULL) AS "hasEmbedding"
      FROM knowledge_documents kd
      INNER JOIN knowledge_document_versions kdv
        ON kdv.id = kd.current_published_version_id
      INNER JOIN knowledge_document_sections kds
        ON kds.document_version_id = kdv.id
      WHERE kdv.status = ${KnowledgeVersionStatus.PUBLISHED}
      ORDER BY kd.code ASC, kds.sort_order ASC, kds.section_code ASC
    `);
  }

  private async backfillKnowledgeItem(
    row: KnowledgeItemEmbeddingRow,
    model: string,
    expectedDimension: number | undefined,
  ): Promise<{ status: 'generated' | 'skipped'; dimension?: number }> {
    const canonicalText = this.contentService.buildKnowledgeItemVersionText(row);
    const contentHash = this.contentService.createContentHash(canonicalText);

    if (this.isCurrentEmbedding(row, model, contentHash)) {
      return { status: 'skipped' };
    }

    const vector = await this.generateValidatedVector(canonicalText, expectedDimension);
    await this.persistKnowledgeItemVector(row.id, vector, model, contentHash);

    return { status: 'generated', dimension: vector.length };
  }

  private async backfillDocumentSection(
    row: KnowledgeDocumentSectionEmbeddingRow,
    model: string,
    expectedDimension: number | undefined,
  ): Promise<{ status: 'generated' | 'skipped'; dimension?: number }> {
    const canonicalText = this.contentService.buildKnowledgeDocumentSectionText(row);
    const contentHash = this.contentService.createContentHash(canonicalText);

    if (this.isCurrentEmbedding(row, model, contentHash)) {
      return { status: 'skipped' };
    }

    const vector = await this.generateValidatedVector(canonicalText, expectedDimension);
    await this.persistDocumentSectionVector(row.id, vector, model, contentHash);

    return { status: 'generated', dimension: vector.length };
  }

  private isCurrentEmbedding(
    row: Pick<KnowledgeItemEmbeddingRow, 'hasEmbedding' | 'embeddingModel' | 'embeddingContentHash'>,
    model: string,
    contentHash: string,
  ): boolean {
    return row.hasEmbedding && row.embeddingModel === model && row.embeddingContentHash === contentHash;
  }

  private async generateValidatedVector(text: string, expectedDimension: number | undefined): Promise<number[]> {
    const vector = await this.embeddingService.embed(text);

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Embedding provider returned an empty vector.');
    }

    if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('Embedding provider returned a vector with a non-finite numeric value.');
    }

    if (expectedDimension !== undefined && vector.length !== expectedDimension) {
      throw new Error(
        `Embedding provider returned dimension ${vector.length}, but expected ${expectedDimension} for model ${this.embeddingService.model}.`,
      );
    }

    return vector;
  }

  private async persistKnowledgeItemVector(
    id: string,
    vector: number[],
    model: string,
    contentHash: string,
  ): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "knowledge_item_versions"
      SET
        "embedding" = ${this.toVectorLiteral(vector)}::vector,
        "embedding_model" = ${model},
        "embedding_content_hash" = ${contentHash},
        "embedded_at" = NOW()
      WHERE "id" = ${id}::uuid
    `);
  }

  private async persistDocumentSectionVector(
    id: string,
    vector: number[],
    model: string,
    contentHash: string,
  ): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "knowledge_document_sections"
      SET
        "embedding" = ${this.toVectorLiteral(vector)}::vector,
        "embedding_model" = ${model},
        "embedding_content_hash" = ${contentHash},
        "embedded_at" = NOW()
      WHERE "id" = ${id}::uuid
    `);
  }

  private toVectorLiteral(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }

  private createBackfillError(
    entityType: string,
    id: string,
    result: KnowledgeEmbeddingBackfillResult,
    cause: unknown,
  ): KnowledgeEmbeddingBackfillError {
    const detail = cause instanceof Error ? cause.message : String(cause);

    return new KnowledgeEmbeddingBackfillError(
      `Failed to backfill ${entityType} ${id}: ${detail}`,
      { ...result },
      cause,
    );
  }
}
