import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';

import { SearchKnowledgeDto } from '../dto/search-knowledge.dto';
import { KnowledgeRetrievalService, KnowledgeSearchResult } from './knowledge-retrieval.service';
import {
  SemanticKnowledgeRetrievalService,
  SemanticKnowledgeSearchResult,
  RetrievalPerformanceContext,
} from './semantic-knowledge-retrieval.service';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const DEFAULT_LEXICAL_WEIGHT = 0.55;
const DEFAULT_SEMANTIC_WEIGHT = 0.45;
const DEFAULT_RRF_K = 60;

type RetrievalCandidate = KnowledgeSearchResult | SemanticKnowledgeSearchResult;

interface HybridCandidate {
  key: string;
  result: RetrievalCandidate;
  fusionScore: number;
  lexicalRank?: number;
  semanticRank?: number;
}

interface HybridConfiguration {
  lexicalWeight: number;
  semanticWeight: number;
  rrfK: number;
}

@Injectable()
export class HybridKnowledgeRetrievalService {
  constructor(
    private readonly lexicalRetrievalService: KnowledgeRetrievalService,
    private readonly semanticRetrievalService: SemanticKnowledgeRetrievalService,
  ) {}

  async search(input: SearchKnowledgeDto, performanceContext?: RetrievalPerformanceContext) {
    const limit = this.resolveLimit(input.limit);
    const candidateLimit = this.resolveCandidateLimit(limit);
    const configuration = this.resolveConfiguration();
    const candidateInput = { ...input, limit: candidateLimit };

    const semanticSearch = performanceContext
      ? this.semanticRetrievalService.search(candidateInput, performanceContext)
      : this.semanticRetrievalService.search(candidateInput);
    const [lexicalResponse, semanticResponse] = await Promise.all([
      this.lexicalRetrievalService.search(candidateInput),
      semanticSearch,
    ]);
    const candidates = new Map<string, HybridCandidate>();

    this.addCandidates(candidates, lexicalResponse.results, 'lexical', configuration);
    this.addCandidates(candidates, semanticResponse.results, 'semantic', configuration);

    const results = [...candidates.values()]
      .sort((left, right) => this.compareCandidates(left, right))
      .slice(0, limit)
      .map(({ result, fusionScore }) => ({ ...result, score: fusionScore }));

    return {
      query: lexicalResponse.query,
      results,
    };
  }

  private addCandidates(
    candidates: Map<string, HybridCandidate>,
    results: RetrievalCandidate[],
    source: 'lexical' | 'semantic',
    configuration: HybridConfiguration,
  ): void {
    results.forEach((result, index) => {
      const rank = index + 1;
      const key = this.getEntityKey(result);
      const existing = candidates.get(key);
      const contribution =
        source === 'lexical'
          ? configuration.lexicalWeight / (configuration.rrfK + rank)
          : configuration.semanticWeight / (configuration.rrfK + rank);

      if (existing) {
        existing.fusionScore += contribution;

        if (source === 'lexical') {
          existing.lexicalRank = rank;
        } else {
          existing.semanticRank = rank;
          // Semantic section results contain documentTitle, which lexical v1 does not expose.
          existing.result = result;
        }

        return;
      }

      candidates.set(key, {
        key,
        result,
        fusionScore: contribution,
        lexicalRank: source === 'lexical' ? rank : undefined,
        semanticRank: source === 'semantic' ? rank : undefined,
      });
    });
  }

  private getEntityKey(result: RetrievalCandidate): string {
    if (result.type === 'KNOWLEDGE_ITEM') {
      return `KNOWLEDGE_ITEM:${result.knowledgeCode}`;
    }

    return `DOCUMENT_SECTION:${result.documentCode}:${result.sectionCode}`;
  }

  private compareCandidates(left: HybridCandidate, right: HybridCandidate): number {
    if (right.fusionScore !== left.fusionScore) {
      return right.fusionScore - left.fusionScore;
    }

    const leftBestRank = Math.min(left.lexicalRank ?? Infinity, left.semanticRank ?? Infinity);
    const rightBestRank = Math.min(right.lexicalRank ?? Infinity, right.semanticRank ?? Infinity);

    if (leftBestRank !== rightBestRank) {
      return leftBestRank - rightBestRank;
    }

    if ((left.lexicalRank ?? Infinity) !== (right.lexicalRank ?? Infinity)) {
      return (left.lexicalRank ?? Infinity) - (right.lexicalRank ?? Infinity);
    }

    if ((left.semanticRank ?? Infinity) !== (right.semanticRank ?? Infinity)) {
      return (left.semanticRank ?? Infinity) - (right.semanticRank ?? Infinity);
    }

    return left.key.localeCompare(right.key);
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

  private resolveCandidateLimit(limit: number): number {
    return Math.min(MAX_LIMIT, Math.max(MAX_LIMIT, limit * 4));
  }

  private resolveConfiguration(): HybridConfiguration {
    const lexicalWeight = this.getNonNegativeEnvironmentNumber('HYBRID_LEXICAL_WEIGHT', DEFAULT_LEXICAL_WEIGHT);
    const semanticWeight = this.getNonNegativeEnvironmentNumber('HYBRID_SEMANTIC_WEIGHT', DEFAULT_SEMANTIC_WEIGHT);
    const rrfK = this.getPositiveEnvironmentNumber('HYBRID_RRF_K', DEFAULT_RRF_K);

    if (lexicalWeight === 0 && semanticWeight === 0) {
      throw new InternalServerErrorException('At least one hybrid retrieval weight must be greater than zero.');
    }

    return { lexicalWeight, semanticWeight, rrfK };
  }

  private getNonNegativeEnvironmentNumber(name: string, defaultValue: number): number {
    const value = this.getEnvironmentNumber(name, defaultValue);

    if (value < 0) {
      throw new InternalServerErrorException(`${name} must be a finite number greater than or equal to zero.`);
    }

    return value;
  }

  private getPositiveEnvironmentNumber(name: string, defaultValue: number): number {
    const value = this.getEnvironmentNumber(name, defaultValue);

    if (value <= 0) {
      throw new InternalServerErrorException(`${name} must be a finite number greater than zero.`);
    }

    return value;
  }

  private getEnvironmentNumber(name: string, defaultValue: number): number {
    const configuredValue = process.env[name]?.trim();

    if (!configuredValue) {
      return defaultValue;
    }

    const value = Number(configuredValue);

    if (!Number.isFinite(value)) {
      throw new InternalServerErrorException(`${name} must be a finite number.`);
    }

    return value;
  }
}
