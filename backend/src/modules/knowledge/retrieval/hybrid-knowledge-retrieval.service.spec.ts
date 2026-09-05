import { KnowledgeAudience } from '../../../generated/prisma/client';

import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { HybridKnowledgeRetrievalService } from './hybrid-knowledge-retrieval.service';
import { SemanticKnowledgeRetrievalService } from './semantic-knowledge-retrieval.service';

describe('HybridKnowledgeRetrievalService', () => {
  const originalEnvironment = {
    lexicalWeight: process.env.HYBRID_LEXICAL_WEIGHT,
    semanticWeight: process.env.HYBRID_SEMANTIC_WEIGHT,
    rrfK: process.env.HYBRID_RRF_K,
  };
  const item = (knowledgeCode: string, audience: KnowledgeAudience = KnowledgeAudience.EMPLOYEE) =>
    ({
      type: 'KNOWLEDGE_ITEM',
      score: 0.8,
      knowledgeCode,
      title: knowledgeCode,
      content: 'content',
      audience,
      resolutionType: 'AUTO_RESPONSE',
      initialResponse: null,
      requiredFields: null,
      operatorTaskType: null,
      operatorInstruction: null,
      successResponseTemplate: null,
      failureResponseTemplate: null,
      acknowledgementMessage: null,
      humanContactMessage: null,
      keywords: [],
      media: [],
    }) as any;

  const section = (documentCode: string, sectionCode: string) =>
    ({
      type: 'DOCUMENT_SECTION',
      score: 0.8,
      documentCode,
      documentTitle: `${documentCode} title`,
      sectionCode,
      title: sectionCode,
      content: 'content',
      audience: KnowledgeAudience.EMPLOYEE,
      keywords: [],
      media: [],
    }) as any;

  const createService = (lexicalResults: any[], semanticResults: any[]) => {
    const lexical = {
      search: jest.fn().mockResolvedValue({ query: 'normalized query', results: lexicalResults }),
    } as unknown as KnowledgeRetrievalService;
    const semantic = {
      search: jest.fn().mockResolvedValue({ query: 'normalized query', results: semanticResults }),
    } as unknown as SemanticKnowledgeRetrievalService;

    return {
      lexical,
      semantic,
      service: new HybridKnowledgeRetrievalService(lexical, semantic),
    };
  };

  beforeEach(() => {
    delete process.env.HYBRID_LEXICAL_WEIGHT;
    delete process.env.HYBRID_SEMANTIC_WEIGHT;
    delete process.env.HYBRID_RRF_K;
  });

  afterAll(() => {
    restoreEnvironmentVariable('HYBRID_LEXICAL_WEIGHT', originalEnvironment.lexicalWeight);
    restoreEnvironmentVariable('HYBRID_SEMANTIC_WEIGHT', originalEnvironment.semanticWeight);
    restoreEnvironmentVariable('HYBRID_RRF_K', originalEnvironment.rrfK);
  });

  it('merges duplicate item and section candidates, with weighted RRF contributions from both paths', async () => {
    const duplicateItem = item('KB_001');
    const duplicateSection = section('DOC_001', 'SECTION_001');
    const { service } = createService([duplicateItem, duplicateSection], [duplicateItem, duplicateSection]);

    const result = await service.search({ query: 'query', audience: KnowledgeAudience.EMPLOYEE });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ type: 'KNOWLEDGE_ITEM', knowledgeCode: 'KB_001' });
    expect(result.results[0].score).toBeCloseTo(1 / 61, 12);
    expect(result.results[1]).toMatchObject({
      type: 'DOCUMENT_SECTION',
      documentCode: 'DOC_001',
      documentTitle: 'DOC_001 title',
    });
  });

  it('keeps valid lexical-only and semantic-only candidates and applies the final limit globally', async () => {
    process.env.HYBRID_LEXICAL_WEIGHT = '0.4';
    process.env.HYBRID_SEMANTIC_WEIGHT = '0.6';
    const { service, lexical, semantic } = createService(
      [item('KB_LEXICAL'), item('KB_OTHER')],
      [section('DOC_SEMANTIC', 'SECTION_001')],
    );

    const result = await service.search({ query: 'query', audience: KnowledgeAudience.EMPLOYEE, limit: 2 });

    expect(result.results).toHaveLength(2);
    expect(result.results.map((candidate) => candidate.type)).toEqual(['DOCUMENT_SECTION', 'KNOWLEDGE_ITEM']);
    expect(lexical.search).toHaveBeenCalledWith({ query: 'query', audience: KnowledgeAudience.EMPLOYEE, limit: 20 });
    expect(semantic.search).toHaveBeenCalledWith({ query: 'query', audience: KnowledgeAudience.EMPLOYEE, limit: 20 });
  });

  it('uses deterministic rank tie breakers', async () => {
    process.env.HYBRID_LEXICAL_WEIGHT = '0.5';
    process.env.HYBRID_SEMANTIC_WEIGHT = '0.5';
    const first = item('KB_A');
    const second = item('KB_B');
    const { service } = createService([first, second], [second, first]);

    const result = await service.search({ query: 'query', audience: KnowledgeAudience.EMPLOYEE });

    expect(
      result.results.map((candidate) =>
        candidate.type === 'KNOWLEDGE_ITEM' ? candidate.knowledgeCode : candidate.documentCode,
      ),
    ).toEqual(['KB_A', 'KB_B']);
  });

  it('preserves audience filtering from both retrievers and propagates semantic failures', async () => {
    const customerItem = item('KB_CUSTOMER', KnowledgeAudience.CUSTOMER);
    const { service, lexical, semantic } = createService([customerItem], []);

    const result = await service.search({ query: 'query', audience: KnowledgeAudience.CUSTOMER });

    expect(result.results).toEqual([expect.objectContaining({ audience: KnowledgeAudience.CUSTOMER })]);
    expect(lexical.search).toHaveBeenCalledWith({ query: 'query', audience: KnowledgeAudience.CUSTOMER, limit: 20 });
    expect(semantic.search).toHaveBeenCalledWith({ query: 'query', audience: KnowledgeAudience.CUSTOMER, limit: 20 });

    const failure = new Error('embedding runtime unavailable');
    const semanticFailure = {
      search: jest.fn().mockRejectedValue(failure),
    } as unknown as SemanticKnowledgeRetrievalService;
    const failureService = new HybridKnowledgeRetrievalService(lexical, semanticFailure);

    await expect(failureService.search({ query: 'query' })).rejects.toThrow('embedding runtime unavailable');
  });

  function restoreEnvironmentVariable(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});
