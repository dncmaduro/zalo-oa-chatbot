import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface KnowledgeItemEmbeddingContentInput {
  title: string;
  category: string;
  subCategory: string | null;
  keywords: string[];
  exampleQuestions: string[];
  userScenarios: string[];
  knowledgeContent: string;
}

export interface KnowledgeDocumentSectionEmbeddingContentInput {
  documentTitle: string;
  sectionTitle: string;
  keywords: string[];
  content: string;
}

@Injectable()
export class KnowledgeEmbeddingContentService {
  buildKnowledgeItemVersionText(input: KnowledgeItemEmbeddingContentInput): string {
    const lines = [`Title: ${this.normalizeText(input.title)}`, `Category: ${this.normalizeText(input.category)}`];
    const subCategory = this.normalizeText(input.subCategory);

    if (subCategory) {
      lines.push(`Subcategory: ${subCategory}`);
    }

    this.appendList(lines, 'Keywords', input.keywords, true);
    this.appendList(lines, 'Example Questions', input.exampleQuestions);
    this.appendList(lines, 'User Scenarios', input.userScenarios);
    lines.push(`Content: ${this.normalizeText(input.knowledgeContent)}`);

    return lines.join('\n');
  }

  buildKnowledgeDocumentSectionText(input: KnowledgeDocumentSectionEmbeddingContentInput): string {
    const lines = [
      `Document Title: ${this.normalizeText(input.documentTitle)}`,
      `Section Title: ${this.normalizeText(input.sectionTitle)}`,
    ];

    this.appendList(lines, 'Keywords', input.keywords, true);
    lines.push(`Content: ${this.normalizeText(input.content)}`);

    return lines.join('\n');
  }

  createContentHash(canonicalText: string): string {
    return createHash('sha256').update(canonicalText).digest('hex');
  }

  private appendList(lines: string[], label: string, values: string[], sort: boolean = false): void {
    let normalizedValues = values.map((value) => this.normalizeText(value)).filter(Boolean);

    if (sort) {
      normalizedValues = [...new Set(normalizedValues)].sort((left, right) => {
        if (left < right) {
          return -1;
        }

        if (left > right) {
          return 1;
        }

        return 0;
      });
    }

    lines.push(`${label}:`);
    lines.push(...normalizedValues.map((value) => `- ${value}`));
  }

  private normalizeText(value: string | null | undefined): string {
    return value?.trim().replace(/\s+/g, ' ') ?? '';
  }
}
