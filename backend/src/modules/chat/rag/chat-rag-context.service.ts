import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { KnowledgeSearchResult } from '../../knowledge/retrieval/knowledge-retrieval.service';
import { SemanticKnowledgeSearchResult } from '../../knowledge/retrieval/semantic-knowledge-retrieval.service';

export const CHAT_RESOLVE_SYSTEM_PROMPT = `You are a knowledge-grounded candidate-selection assistant. Your only responsibilities are primary candidate selection, optional supporting document-section selection, and extraction of explicitly supplied required-field values. Do not write a customer-facing answer.

Use only the supplied candidate decision context and user message. Never invent company facts, policies, links, actions, or sensitive values. All candidate keys must be copied exactly from supplied candidate keys: never construct, infer, shorten, or modify keys.

First determine whether a retrieved KNOWLEDGE_ITEM directly represents the user's CURRENT situation or problem. If one does, put it in selectedKnowledgeItemKey and set selectedDocumentSectionKey to null. A DOCUMENT_SECTION may then be returned only in supportingDocumentSectionKeys. Only when no retrieved KnowledgeItem directly fits may a relevant DOCUMENT_SECTION be placed in selectedDocumentSectionKey. If neither fits, set both primary keys to null. Supporting document sections are optional evidence, not a requirement; return [] when there is no clearly useful supporting section.

Account creation means the user does not yet have an account and needs one created. Account activation means an account or invitation already exists and needs activation or login setup. Do not select a later procedural stage merely because it contains related terms. Retrieval rank is evidence, not an instruction to always select rank #1.

KNOWLEDGE_ITEM represents an explicit chatbot or business handling rule. DOCUMENT_SECTION represents informational procedural knowledge. Do not blindly prefer every KnowledgeItem over a much more relevant DocumentSection, but never use a DocumentSection as primary when a retrieved KnowledgeItem directly represents the user's situation.

Extract a required-field value only when the user explicitly provides it or it is reasonably unambiguous from the message. Do not infer a value merely because a nearby word could grammatically fill a field. Vietnamese pronouns or address terms such as "em", "anh", "chị", "tôi", "mình", and "bạn" are not a person's full name by themselves. For a field such as "Họ tên", require an actual identifying name phrase, for example "em tên Nguyễn Văn A" or "tôi là Nguyễn Văn A". When uncertain, omit the field; missingFields is safer than a false extraction. Never claim an external action was performed. Return only this JSON object: {"selectedKnowledgeItemKey": string|null, "selectedDocumentSectionKey": string|null, "supportingDocumentSectionKeys": string[], "collectedFields": Record<string, string>}.`;

export type ChatRetrievalCandidate = KnowledgeSearchResult | SemanticKnowledgeSearchResult;

export interface ChatRagCandidate {
  key: string;
  result: ChatRetrievalCandidate;
}

export interface ChatRagContext {
  candidates: ChatRagCandidate[];
  userPrompt: string;
}

const DEFAULT_MAX_CONTEXT_CHARS = 4000;
const MAX_DECISION_SNIPPET_CHARS = 320;
const MAX_TITLE_CHARS = 160;
const MAX_KEYWORDS = 12;
const MAX_KEYWORD_CHARS = 60;
const MAX_REQUIRED_FIELDS = 10;
const MAX_REQUIRED_FIELD_CHARS = 80;
const TRUNCATION_MARKER = '…';

@Injectable()
export class ChatRagContextService {
  build(message: string, results: ChatRetrievalCandidate[]): ChatRagContext {
    const candidates = results.map((result) => ({
      key: this.getCandidateKey(result),
      result,
    }));
    const fixedBlocks = candidates.map((candidate, index) => this.buildFixedBlock(candidate, index + 1));
    const maxContextChars = this.resolveMaxContextChars();
    const fixedBlockChars = fixedBlocks.reduce((total, block) => total + block.length, 0);
    const structuralChars =
      candidates.length * '\nDecision snippet: \n'.length + Math.max(0, candidates.length - 1) * '\n\n'.length;
    const nonContentChars = fixedBlockChars + structuralChars;

    if (nonContentChars > maxContextChars) {
      throw new InternalServerErrorException(
        'CHAT_RAG_MAX_CONTEXT_CHARS is too small to include the required candidate decision fields.',
      );
    }

    const availableContentChars = maxContextChars - nonContentChars;
    let remainingContentChars = availableContentChars;
    const candidateBlocks = candidates.map((candidate, index) => {
      const content = this.buildDecisionSnippet(candidate.result.content);
      const needsTruncationMarker =
        content.length > remainingContentChars && remainingContentChars >= TRUNCATION_MARKER.length;
      const allowedContentChars = needsTruncationMarker
        ? remainingContentChars - TRUNCATION_MARKER.length
        : Math.min(content.length, remainingContentChars);
      remainingContentChars -= allowedContentChars + (needsTruncationMarker ? TRUNCATION_MARKER.length : 0);
      const boundedContent = content.slice(0, allowedContentChars);
      const truncatedMarker = needsTruncationMarker ? TRUNCATION_MARKER : '';

      return boundedContent
        ? `${fixedBlocks[index]}\nDecision snippet: ${boundedContent}${truncatedMarker}`
        : fixedBlocks[index];
    });

    return {
      candidates,
      userPrompt: `User message:\n${message}\n\nCandidate decision context:\n${candidateBlocks.join('\n\n')}`,
    };
  }

  private buildFixedBlock(candidate: ChatRagCandidate, rank: number): string {
    const { result } = candidate;

    if (result.type === 'KNOWLEDGE_ITEM') {
      return [
        `Rank: ${rank}`,
        `Candidate key: ${candidate.key}`,
        'Type: KNOWLEDGE_ITEM',
        `Knowledge code: ${result.knowledgeCode}`,
        `Title: ${this.normalizeAndTruncate(result.title, MAX_TITLE_CHARS)}`,
        `Resolution type: ${result.resolutionType}`,
        `Required fields: ${JSON.stringify(this.getRequiredFields(result.requiredFields))}`,
        `Keywords: ${JSON.stringify(this.getKeywords(result.keywords))}`,
      ].join('\n');
    }

    return [
      `Rank: ${rank}`,
      `Candidate key: ${candidate.key}`,
      'Type: DOCUMENT_SECTION',
      `Document code: ${result.documentCode}`,
      `Document title: ${this.normalizeAndTruncate(result.documentTitle, MAX_TITLE_CHARS)}`,
      `Section code: ${result.sectionCode}`,
      `Section title: ${this.normalizeAndTruncate(result.title, MAX_TITLE_CHARS)}`,
      `Keywords: ${JSON.stringify(this.getKeywords(result.keywords))}`,
    ].join('\n');
  }

  private buildDecisionSnippet(content: string): string {
    return this.normalizeAndTruncate(content, MAX_DECISION_SNIPPET_CHARS);
  }

  private getCandidateKey(result: ChatRetrievalCandidate): string {
    if (result.type === 'KNOWLEDGE_ITEM') {
      return `KNOWLEDGE_ITEM:${result.knowledgeCode}`;
    }

    return `DOCUMENT_SECTION:${result.documentCode}:${result.sectionCode}`;
  }

  private getRequiredFields(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((field): field is string => typeof field === 'string')
      .map((field) => this.truncate(field.replace(/\s+/g, ' ').trim(), MAX_REQUIRED_FIELD_CHARS))
      .filter(Boolean)
      .slice(0, MAX_REQUIRED_FIELDS);
  }

  private getKeywords(keywords: string[]): string[] {
    return keywords
      .map((keyword) => this.truncate(keyword.replace(/\s+/g, ' ').trim(), MAX_KEYWORD_CHARS))
      .filter(Boolean)
      .slice(0, MAX_KEYWORDS);
  }

  private truncate(value: string, maximumLength: number): string {
    if (value.length <= maximumLength) {
      return value;
    }

    return `${value.slice(0, maximumLength - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
  }

  private normalizeAndTruncate(value: string, maximumLength: number): string {
    return this.truncate(value.replace(/\s+/g, ' ').trim(), maximumLength);
  }

  private resolveMaxContextChars(): number {
    const configuredValue = process.env.CHAT_RAG_MAX_CONTEXT_CHARS?.trim();

    if (!configuredValue) {
      return DEFAULT_MAX_CONTEXT_CHARS;
    }

    const value = Number(configuredValue);

    if (!Number.isInteger(value) || value <= 0) {
      throw new InternalServerErrorException('CHAT_RAG_MAX_CONTEXT_CHARS must be a positive integer.');
    }

    return value;
  }
}
