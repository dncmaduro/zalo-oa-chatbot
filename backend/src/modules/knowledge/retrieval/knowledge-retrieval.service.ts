import { BadRequestException, Injectable } from '@nestjs/common';

import { KnowledgeAudience, KnowledgeVersionStatus, Prisma, ResolutionType } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

import { SearchKnowledgeDto } from '../dto/search-knowledge.dto';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MINIMUM_LEXICAL_SCORE = 0.15;

export interface KnowledgeMediaResult {
  mediaCode: string;
  secureUrl: string;
  description: string | null;
}

interface KnowledgeItemSearchRow {
  type: 'KNOWLEDGE_ITEM';
  score: number;
  knowledgeCode: string;
  title: string;
  content: string;
  audience: KnowledgeAudience;
  resolutionType: ResolutionType;
  initialResponse: string | null;
  requiredFields: Prisma.JsonValue | null;
  operatorTaskType: string | null;
  operatorInstruction: string | null;
  successResponseTemplate: string | null;
  failureResponseTemplate: string | null;
  acknowledgementMessage: string | null;
  humanContactMessage: string | null;
  keywords: string[];
  media: unknown;
}

interface DocumentSectionSearchRow {
  type: 'DOCUMENT_SECTION';
  score: number;
  documentCode: string;
  documentTitle: string;
  sectionCode: string;
  title: string;
  content: string;
  audience: KnowledgeAudience;
  keywords: string[];
  media: unknown;
}

export type KnowledgeSearchResult =
  | {
      type: 'KNOWLEDGE_ITEM';
      score: number;
      knowledgeCode: string;
      title: string;
      content: string;
      audience: KnowledgeAudience;
      resolutionType: ResolutionType;
      initialResponse: string | null;
      requiredFields: Prisma.JsonValue | null;
      operatorTaskType: string | null;
      operatorInstruction: string | null;
      successResponseTemplate: string | null;
      failureResponseTemplate: string | null;
      acknowledgementMessage: string | null;
      humanContactMessage: string | null;
      keywords: string[];
      media: KnowledgeMediaResult[];
    }
  | {
      type: 'DOCUMENT_SECTION';
      score: number;
      documentCode: string;
      documentTitle: string;
      sectionCode: string;
      title: string;
      content: string;
      audience: KnowledgeAudience;
      keywords: string[];
      media: KnowledgeMediaResult[];
    };

@Injectable()
export class KnowledgeRetrievalService {
  constructor(private readonly prisma: PrismaService) {}

  async search(input: SearchKnowledgeDto) {
    const query = this.normalizeQuery(input.query);
    const audience = this.resolveAudience(input.audience);
    const limit = this.resolveLimit(input.limit);
    const allowedAudiences = this.getAllowedAudiences(audience);
    const candidateLimit = MAX_LIMIT;

    const [items, sections] = await Promise.all([
      this.searchKnowledgeItems(query, allowedAudiences, candidateLimit),
      this.searchDocumentSections(query, allowedAudiences, candidateLimit),
    ]);

    // `score` is lexical v1. A future semantic score can be combined here
    // without changing the controller or response contract.
    const results = [...items, ...sections].sort((left, right) => this.compareResults(left, right)).slice(0, limit);

    return {
      query,
      results,
    };
  }

  private async searchKnowledgeItems(
    query: string,
    allowedAudiences: KnowledgeAudience[],
    candidateLimit: number,
  ): Promise<KnowledgeSearchResult[]> {
    const rows = await this.prisma.$queryRaw<KnowledgeItemSearchRow[]>(Prisma.sql`
      SELECT *
      FROM (
        SELECT
          'KNOWLEDGE_ITEM'::text AS type,
          ki.code AS "knowledgeCode",
          kiv.title,
          kiv.knowledge_content AS content,
          kiv.audience,
          kiv.resolution_type AS "resolutionType",
          kiv.initial_response AS "initialResponse",
          kiv.required_fields AS "requiredFields",
          kiv.operator_task_type AS "operatorTaskType",
          kiv.operator_instruction AS "operatorInstruction",
          kiv.success_response_template AS "successResponseTemplate",
          kiv.failure_response_template AS "failureResponseTemplate",
          kiv.acknowledgement_message AS "acknowledgementMessage",
          kiv.human_contact_message AS "humanContactMessage",
          kiv.keywords,
          COALESCE(item_media.media, '[]'::jsonb) AS media,
          (
            0.42 * similarity(lower(COALESCE(array_to_string(kiv.example_questions, ' '), '')), lower(${query})) +
            0.32 * similarity(lower(kiv.title), lower(${query})) +
            0.18 * similarity(lower(COALESCE(array_to_string(kiv.keywords, ' '), '')), lower(${query})) +
            0.12 * similarity(lower(COALESCE(array_to_string(kiv.user_scenarios, ' '), '')), lower(${query})) +
            0.08 * similarity(lower(kiv.knowledge_content), lower(${query})) +
            CASE
              WHEN lower(COALESCE(array_to_string(kiv.example_questions, ' '), '')) LIKE '%' || lower(${query}) || '%'
                THEN 0.40
              ELSE 0
            END +
            CASE
              WHEN lower(kiv.title) = lower(${query}) THEN 0.30
              WHEN lower(kiv.title) LIKE '%' || lower(${query}) || '%' THEN 0.16
              ELSE 0
            END
          )::double precision AS score
        FROM knowledge_items ki
        INNER JOIN knowledge_item_versions kiv
          ON kiv.id = ki.current_published_version_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'mediaCode', km.media_code,
              'secureUrl', km.secure_url,
              'description', km.description
            )
            ORDER BY kivm.sort_order ASC, km.media_code ASC
          ) AS media
          FROM knowledge_item_version_media kivm
          INNER JOIN knowledge_media km ON km.id = kivm.media_id
          WHERE kivm.knowledge_item_version_id = kiv.id
        ) item_media ON TRUE
        WHERE kiv.status = ${KnowledgeVersionStatus.PUBLISHED}
          AND kiv.audience IN (${Prisma.join(allowedAudiences)})
      ) candidates
      WHERE score >= ${MINIMUM_LEXICAL_SCORE}
      ORDER BY score DESC, "knowledgeCode" ASC
      LIMIT ${candidateLimit}
    `);

    return rows.map((row) => ({
      type: 'KNOWLEDGE_ITEM',
      score: Number(row.score),
      knowledgeCode: row.knowledgeCode,
      title: row.title,
      content: row.content,
      audience: row.audience,
      resolutionType: row.resolutionType,
      initialResponse: row.initialResponse,
      requiredFields: row.requiredFields,
      operatorTaskType: row.operatorTaskType,
      operatorInstruction: row.operatorInstruction,
      successResponseTemplate: row.successResponseTemplate,
      failureResponseTemplate: row.failureResponseTemplate,
      acknowledgementMessage: row.acknowledgementMessage,
      humanContactMessage: row.humanContactMessage,
      keywords: row.keywords,
      media: this.normalizeMedia(row.media),
    }));
  }

  private async searchDocumentSections(
    query: string,
    allowedAudiences: KnowledgeAudience[],
    candidateLimit: number,
  ): Promise<KnowledgeSearchResult[]> {
    const rows = await this.prisma.$queryRaw<DocumentSectionSearchRow[]>(Prisma.sql`
      SELECT *
      FROM (
        SELECT
          'DOCUMENT_SECTION'::text AS type,
          kd.code AS "documentCode",
          kdv.title AS "documentTitle",
          kds.section_code AS "sectionCode",
          kds.section_title AS title,
          kds.content,
          kdv.audience,
          kds.keywords,
          COALESCE(section_media.media, '[]'::jsonb) AS media,
          (
            0.40 * similarity(lower(kds.section_title), lower(${query})) +
            0.22 * similarity(lower(COALESCE(array_to_string(kds.keywords, ' '), '')), lower(${query})) +
            0.18 * similarity(lower(kdv.title), lower(${query})) +
            0.12 * similarity(lower(kds.content), lower(${query})) +
            CASE
              WHEN lower(kds.section_title) = lower(${query}) THEN 0.35
              WHEN lower(kds.section_title) LIKE '%' || lower(${query}) || '%' THEN 0.18
              ELSE 0
            END +
            CASE
              WHEN lower(kdv.title) LIKE '%' || lower(${query}) || '%' THEN 0.12
              ELSE 0
            END
          )::double precision AS score
        FROM knowledge_documents kd
        INNER JOIN knowledge_document_versions kdv
          ON kdv.id = kd.current_published_version_id
        INNER JOIN knowledge_document_sections kds
          ON kds.document_version_id = kdv.id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'mediaCode', km.media_code,
              'secureUrl', km.secure_url,
              'description', km.description
            )
            ORDER BY ksm.sort_order ASC, km.media_code ASC
          ) AS media
          FROM knowledge_section_media ksm
          INNER JOIN knowledge_media km ON km.id = ksm.media_id
          WHERE ksm.section_id = kds.id
        ) section_media ON TRUE
        WHERE kdv.status = ${KnowledgeVersionStatus.PUBLISHED}
          AND kdv.audience IN (${Prisma.join(allowedAudiences)})
      ) candidates
      WHERE score >= ${MINIMUM_LEXICAL_SCORE}
      ORDER BY score DESC, "documentCode" ASC, "sectionCode" ASC
      LIMIT ${candidateLimit}
    `);

    return rows.map((row) => ({
      type: 'DOCUMENT_SECTION',
      score: Number(row.score),
      documentCode: row.documentCode,
      documentTitle: row.documentTitle,
      sectionCode: row.sectionCode,
      title: row.title,
      content: row.content,
      audience: row.audience,
      keywords: row.keywords,
      media: this.normalizeMedia(row.media),
    }));
  }

  private normalizeQuery(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('query must be a non-empty string');
    }

    const query = value.trim().replace(/\s+/g, ' ');

    if (!query) {
      throw new BadRequestException('query must not be empty');
    }

    return query;
  }

  private resolveAudience(value: unknown): KnowledgeAudience {
    if (value === undefined || value === null) {
      return KnowledgeAudience.CUSTOMER;
    }

    if (!Object.values(KnowledgeAudience).includes(value as KnowledgeAudience)) {
      throw new BadRequestException('audience is invalid');
    }

    return value as KnowledgeAudience;
  }

  private resolveLimit(value: unknown): number {
    if (value === undefined || value === null) {
      return DEFAULT_LIMIT;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return Math.min(value, MAX_LIMIT);
  }

  private getAllowedAudiences(audience: KnowledgeAudience): KnowledgeAudience[] {
    return [audience, KnowledgeAudience.ALL];
  }

  private normalizeMedia(value: unknown): KnowledgeMediaResult[] {
    const media = this.toJsonArray(value);

    return media.flatMap((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.mediaCode !== 'string' ||
        typeof item.secureUrl !== 'string'
      ) {
        return [];
      }

      return [
        {
          mediaCode: item.mediaCode,
          secureUrl: item.secureUrl,
          description: typeof item.description === 'string' ? item.description : null,
        },
      ];
    });
  }

  private toJsonArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value as Array<Record<string, unknown>>;
    }

    if (typeof value !== 'string') {
      return [];
    }

    try {
      const parsed = JSON.parse(value);

      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private compareResults(left: KnowledgeSearchResult, right: KnowledgeSearchResult): number {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const leftKey =
      left.type === 'KNOWLEDGE_ITEM' ? `0:${left.knowledgeCode}` : `1:${left.documentCode}:${left.sectionCode}`;
    const rightKey =
      right.type === 'KNOWLEDGE_ITEM' ? `0:${right.knowledgeCode}` : `1:${right.documentCode}:${right.sectionCode}`;

    return leftKey.localeCompare(rightKey);
  }
}
