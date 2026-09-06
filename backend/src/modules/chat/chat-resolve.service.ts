import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

import { KnowledgeAudience, ResolutionType } from '../../generated/prisma/client';
import { LlmService } from '../llm/llm.service';
import { HybridKnowledgeRetrievalService } from '../knowledge/retrieval/hybrid-knowledge-retrieval.service';

import { ResolveChatDto } from './dto/resolve-chat.dto';
import { CHAT_RESOLVE_SYSTEM_PROMPT, ChatRagCandidate, ChatRagContextService } from './rag/chat-rag-context.service';

const RETRIEVAL_CANDIDATE_LIMIT = 5;
const DECISION_MAX_OUTPUT_TOKENS = 96;
const FULL_NAME_FIELD_NAMES = new Set(['họ tên', 'họ và tên']);
const VIETNAMESE_NAME_PRONOUNS = new Set(['em', 'anh', 'chị', 'tôi', 'mình', 'bạn']);

interface ChatModelDecision {
  selectedKnowledgeItemKey: string | null;
  selectedDocumentSectionKey: string | null;
  supportingDocumentSectionKeys: string[];
  collectedFields: Record<string, string>;
}

export interface ChatResolveResult {
  resolutionType: ResolutionType;
  selectedKnowledge:
    | {
        type: 'KNOWLEDGE_ITEM';
        knowledgeCode: string;
      }
    | {
        type: 'DOCUMENT_SECTION';
        documentCode: string;
        sectionCode: string;
      }
    | null;
  response: string;
  requiredFields: string[];
  collectedFields: Record<string, string>;
  missingFields: string[];
  operatorTaskType: string | null;
  operatorInstruction: string | null;
  supportingKnowledge: Array<
    | {
        type: 'KNOWLEDGE_ITEM';
        knowledgeCode: string;
      }
    | {
        type: 'DOCUMENT_SECTION';
        documentCode: string;
        sectionCode: string;
      }
  >;
  model: string | null;
}

export interface ChatResolvePerformanceContext {
  conversationId: string;
  inboundMessageId: string;
}

@Injectable()
export class ChatResolveService {
  private readonly logger = new Logger(ChatResolveService.name);

  constructor(
    private readonly hybridRetrievalService: HybridKnowledgeRetrievalService,
    private readonly ragContextService: ChatRagContextService,
    private readonly llmService: LlmService,
  ) {}

  async resolve(input: ResolveChatDto, performanceContext?: ChatResolvePerformanceContext): Promise<ChatResolveResult> {
    const performanceLoggingEnabled = this.isPerformanceLoggingEnabled();
    const startedAt = performance.now();
    const message = this.normalizeMessage(input.message);
    const audience = this.resolveAudience(input.audience);
    const retrievalStartedAt = performance.now();
    const retrievalInput = {
      query: message,
      audience,
      limit: RETRIEVAL_CANDIDATE_LIMIT,
    };
    const retrieval = performanceContext
      ? await this.hybridRetrievalService.search(retrievalInput, performanceContext)
      : await this.hybridRetrievalService.search(retrievalInput);
    const retrievalMs = this.elapsedMs(retrievalStartedAt);

    if (retrieval.results.length === 0) {
      const result = this.createHumanContactFallback(null);

      this.logPerformance(performanceLoggingEnabled, {
        retrievalMs,
        ragContextBuildMs: 0,
        llmMs: 0,
        serverValidationMs: 0,
        totalMs: this.elapsedMs(startedAt),
        systemPromptChars: 0,
        candidateCount: 0,
        knowledgeItemCandidateCount: 0,
        documentSectionCandidateCount: 0,
        decisionContextChars: 0,
        userPromptChars: 0,
      }, performanceContext);

      return result;
    }

    const ragContextBuildStartedAt = performance.now();
    const context = this.ragContextService.build(message, retrieval.results);
    const ragContextBuildMs = this.elapsedMs(ragContextBuildStartedAt);
    const llmStartedAt = performance.now();
    const rawDecision = await this.llmService.generateStructured({
      systemPrompt: this.getSystemPrompt(),
      userPrompt: context.userPrompt,
      maxOutputTokens: DECISION_MAX_OUTPUT_TOKENS,
      metadata: {
        purpose: 'chat_resolve',
        correlationId: performanceContext ? `${performanceContext.conversationId}:${performanceContext.inboundMessageId}` : undefined,
      },
    });
    const llmMs = this.elapsedMs(llmStartedAt);
    const serverValidationStartedAt = performance.now();
    const decision = this.validateDecision(rawDecision, context.candidates);
    const model = this.llmService.model;
    let result: ChatResolveResult;

    const selectedCandidateKey = decision.selectedKnowledgeItemKey ?? decision.selectedDocumentSectionKey;

    if (selectedCandidateKey === null) {
      result = this.createHumanContactFallback(model);
    } else {
      const selectedCandidate = context.candidates.find((candidate) => candidate.key === selectedCandidateKey);

      if (!selectedCandidate) {
        throw new InternalServerErrorException('LLM selected a knowledge candidate that was not retrieved.');
      }

      const supportingKnowledge = decision.supportingDocumentSectionKeys
        .map((key) => context.candidates.find((candidate) => candidate.key === key))
        .filter(
          (candidate): candidate is ChatRagCandidate =>
            candidate !== undefined && candidate.result.type === 'DOCUMENT_SECTION',
        )
        .map((candidate) => this.toKnowledgeReference(candidate));

      if (selectedCandidate.result.type === 'DOCUMENT_SECTION') {
        result = {
          resolutionType: ResolutionType.AUTO_RESPONSE,
          selectedKnowledge: this.toKnowledgeReference(selectedCandidate),
          response: selectedCandidate.result.content,
          requiredFields: [],
          collectedFields: {},
          missingFields: [],
          operatorTaskType: null,
          operatorInstruction: null,
          supportingKnowledge,
          model,
        };
      } else {
        const item = selectedCandidate.result;
        const requiredFields = this.getRequiredFields(item.requiredFields);
        const collectedFields = this.validateCollectedFields(decision.collectedFields, requiredFields);
        const missingFields = requiredFields.filter((field) => collectedFields[field] === undefined);

        result = {
          resolutionType: item.resolutionType,
          selectedKnowledge: this.toKnowledgeReference(selectedCandidate),
          response: this.resolveKnowledgeItemResponse(item),
          requiredFields,
          collectedFields,
          missingFields,
          operatorTaskType: item.resolutionType === ResolutionType.OPERATOR_TASK ? item.operatorTaskType : null,
          operatorInstruction: item.resolutionType === ResolutionType.OPERATOR_TASK ? item.operatorInstruction : null,
          supportingKnowledge,
          model,
        };
      }
    }

    this.logPerformance(performanceLoggingEnabled, {
      retrievalMs,
      ragContextBuildMs,
      llmMs,
      serverValidationMs: this.elapsedMs(serverValidationStartedAt),
      totalMs: this.elapsedMs(startedAt),
      systemPromptChars: this.getSystemPrompt().length,
      ...context.metrics,
    }, performanceContext);

    return result;
  }

  private getSystemPrompt(): string {
    return CHAT_RESOLVE_SYSTEM_PROMPT;
  }

  private validateDecision(value: unknown, candidates: ChatRagCandidate[]): ChatModelDecision {
    if (!this.isRecord(value)) {
      throw new InternalServerErrorException('LLM returned an invalid structured decision.');
    }

    const selectedKnowledgeItemKey = this.validatePrimaryCandidateKey(
      value.selectedKnowledgeItemKey,
      'selectedKnowledgeItemKey',
      'KNOWLEDGE_ITEM',
      candidates,
    );
    const selectedDocumentSectionKey = selectedKnowledgeItemKey
      ? null
      : this.validatePrimaryCandidateKey(
          value.selectedDocumentSectionKey,
          'selectedDocumentSectionKey',
          'DOCUMENT_SECTION',
          candidates,
        );

    if (
      !Array.isArray(value.supportingDocumentSectionKeys) ||
      !value.supportingDocumentSectionKeys.every((key) => typeof key === 'string')
    ) {
      throw new InternalServerErrorException('LLM returned invalid supportingDocumentSectionKeys.');
    }

    const supportingDocumentSectionKeys = [
      ...new Set(
        value.supportingDocumentSectionKeys.filter((key) => {
          const candidate = candidates.find((entry) => entry.key === key);

          return candidate?.result.type === 'DOCUMENT_SECTION' && key !== selectedDocumentSectionKey;
        }),
      ),
    ];

    if (!this.isRecord(value.collectedFields)) {
      throw new InternalServerErrorException('LLM returned invalid collectedFields.');
    }

    const collectedFields = Object.fromEntries(
      Object.entries(value.collectedFields).map(([key, fieldValue]) => {
        if (typeof fieldValue !== 'string') {
          throw new InternalServerErrorException('LLM returned a non-string collected field value.');
        }

        return [key, fieldValue.trim()];
      }),
    );
    return {
      selectedKnowledgeItemKey,
      selectedDocumentSectionKey,
      supportingDocumentSectionKeys,
      collectedFields,
    };
  }

  private validatePrimaryCandidateKey(
    value: unknown,
    fieldName: string,
    type: ChatRagCandidate['result']['type'],
    candidates: ChatRagCandidate[],
  ): string | null {
    if (value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new InternalServerErrorException(`LLM returned an invalid ${fieldName}.`);
    }

    const candidate = candidates.find((entry) => entry.key === value);

    if (!candidate || candidate.result.type !== type) {
      throw new InternalServerErrorException(`LLM selected an invalid ${fieldName}.`);
    }

    return value;
  }

  private validateCollectedFields(
    modelCollectedFields: Record<string, string>,
    requiredFields: string[],
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(modelCollectedFields).filter(
        ([field, value]) =>
          requiredFields.includes(field) && value.length > 0 && !this.isStandaloneNamePronoun(field, value),
      ),
    );
  }

  private isStandaloneNamePronoun(field: string, value: string): boolean {
    const normalizedField = field.trim().toLowerCase();
    const normalizedValue = value
      .trim()
      .toLowerCase()
      .replace(/[.,;:!?]+$/g, '');

    return FULL_NAME_FIELD_NAMES.has(normalizedField) && VIETNAMESE_NAME_PRONOUNS.has(normalizedValue);
  }

  private getRequiredFields(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const fields = value
      .filter((field): field is string => typeof field === 'string')
      .map((field) => field.trim())
      .filter(Boolean);

    return [...new Set(fields)];
  }

  private resolveKnowledgeItemResponse(item: Extract<ChatRagCandidate['result'], { type: 'KNOWLEDGE_ITEM' }>): string {
    switch (item.resolutionType) {
      case ResolutionType.OPERATOR_TASK:
        return item.acknowledgementMessage ?? item.initialResponse ?? item.content;
      case ResolutionType.HUMAN_CONTACT:
        return item.humanContactMessage ?? this.getRequiredEnvironmentVariable('CHAT_HUMAN_CONTACT_FALLBACK_MESSAGE');
      case ResolutionType.AUTO_RESPONSE:
      default:
        return item.initialResponse ?? item.content;
    }
  }

  private createHumanContactFallback(model: string | null): ChatResolveResult {
    return {
      resolutionType: ResolutionType.HUMAN_CONTACT,
      selectedKnowledge: null,
      response: this.getRequiredEnvironmentVariable('CHAT_HUMAN_CONTACT_FALLBACK_MESSAGE'),
      requiredFields: [],
      collectedFields: {},
      missingFields: [],
      operatorTaskType: null,
      operatorInstruction: null,
      supportingKnowledge: [],
      model,
    };
  }

  private toKnowledgeReference(candidate: ChatRagCandidate): NonNullable<ChatResolveResult['selectedKnowledge']> {
    if (candidate.result.type === 'KNOWLEDGE_ITEM') {
      return {
        type: 'KNOWLEDGE_ITEM',
        knowledgeCode: candidate.result.knowledgeCode,
      };
    }

    return {
      type: 'DOCUMENT_SECTION',
      documentCode: candidate.result.documentCode,
      sectionCode: candidate.result.sectionCode,
    };
  }

  private normalizeMessage(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('message must be a non-empty string');
    }

    const message = value.trim().replace(/\s+/g, ' ');

    if (!message) {
      throw new BadRequestException('message must not be empty');
    }

    return message;
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

  private getRequiredEnvironmentVariable(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new InternalServerErrorException(`${name} must be configured for chat resolve.`);
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isPerformanceLoggingEnabled(): boolean {
    return process.env.LLM_PERF_LOG?.trim().toLowerCase() === 'true';
  }

  private logPerformance(
    enabled: boolean,
    metrics: {
      retrievalMs: number;
      ragContextBuildMs: number;
      llmMs: number;
      serverValidationMs: number;
      totalMs: number;
      systemPromptChars: number;
      candidateCount: number;
      knowledgeItemCandidateCount: number;
      documentSectionCandidateCount: number;
      decisionContextChars: number;
      userPromptChars: number;
    },
    performanceContext?: ChatResolvePerformanceContext,
  ): void {
    if (!enabled) {
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'chat_resolve_performance',
        ...performanceContext,
        ...metrics,
      }),
    );
  }

  private elapsedMs(startedAt: number): number {
    return Math.round(performance.now() - startedAt);
  }
}
