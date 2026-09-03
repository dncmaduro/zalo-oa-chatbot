import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import { KnowledgeAudience, Prisma, ResolutionType } from '../../../generated/prisma/client';
import { EmbeddingService } from '../../embedding/embedding.service';
import { PrismaService } from '../../../prisma/prisma.service';

import { SemanticKnowledgeRetrievalService } from './semantic-knowledge-retrieval.service';

describe('SemanticKnowledgeRetrievalService', () => {
  const itemRow = {
    type: 'KNOWLEDGE_ITEM' as const,
    score: 0.81,
    knowledgeCode: 'KB_001',
    title: 'Reset password',
    content: 'Password reset instructions',
    audience: KnowledgeAudience.EMPLOYEE,
    resolutionType: ResolutionType.AUTO_RESPONSE,
    initialResponse: 'I can help reset your password.',
    requiredFields: null,
    operatorTaskType: null,
    operatorInstruction: null,
    successResponseTemplate: null,
    failureResponseTemplate: null,
    acknowledgementMessage: null,
    humanContactMessage: null,
    keywords: ['password', 'reset'],
    media: [{ mediaCode: 'IMG_001', secureUrl: 'https://example.com/image.png', description: 'Guide image' }],
  };

  const sectionRow = {
    type: 'DOCUMENT_SECTION' as const,
    score: 0.93,
    documentCode: 'DOC_001',
    documentTitle: 'Account guide',
    sectionCode: 'SECTION_001',
    title: 'Password guide',
    content: 'Document content',
    audience: KnowledgeAudience.EMPLOYEE,
    keywords: ['password'],
    media: [],
  };

  const createService = (vector: unknown = [0.1, 0.2, 0.3]) => {
    const $queryRaw = jest.fn().mockResolvedValueOnce([itemRow]).mockResolvedValueOnce([sectionRow]);
    const embeddingService = {
      model: 'qwen3-embedding:0.6b',
      embed: jest.fn().mockResolvedValue(vector),
    } as unknown as EmbeddingService;
    const service = new SemanticKnowledgeRetrievalService({ $queryRaw } as unknown as PrismaService, embeddingService);

    return { service, $queryRaw, embeddingService };
  };

  it('uses a validated query embedding and current-model/current-published vector SQL', async () => {
    const { service, $queryRaw, embeddingService } = createService();

    const result = await service.search({
      query: '  reset   password  ',
      audience: KnowledgeAudience.EMPLOYEE,
      limit: 1,
    });

    const itemSql = $queryRaw.mock.calls[0][0] as Prisma.Sql;
    const sectionSql = $queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(embeddingService.embed).toHaveBeenCalledWith('reset password');
    expect(itemSql.strings.join('')).toContain('kiv.embedding <=>');
    expect(itemSql.strings.join('')).toContain('kiv.embedding_model =');
    expect(itemSql.strings.join('')).toContain('kiv.id = ki.current_published_version_id');
    expect(sectionSql.strings.join('')).toContain('kds.embedding <=>');
    expect(sectionSql.strings.join('')).toContain('kds.embedding_model =');
    expect(sectionSql.strings.join('')).toContain('kdv.id = kd.current_published_version_id');
    expect((service as any).getAllowedAudiences(KnowledgeAudience.EMPLOYEE)).toEqual([
      KnowledgeAudience.EMPLOYEE,
      KnowledgeAudience.ALL,
    ]);
    expect(result).toEqual({
      query: 'reset password',
      results: [
        expect.objectContaining({
          type: 'DOCUMENT_SECTION',
          documentCode: 'DOC_001',
          documentTitle: 'Account guide',
          score: 0.93,
        }),
      ],
    });
  });

  it('rejects empty queries before embedding and invalid query vectors before SQL', async () => {
    const emptyQuery = createService();

    await expect(emptyQuery.service.search({ query: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(emptyQuery.embeddingService.embed).not.toHaveBeenCalled();

    const invalidVector = createService([0.1, Number.NaN]);

    await expect(invalidVector.service.search({ query: 'reset password' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(invalidVector.$queryRaw).not.toHaveBeenCalled();
  });
});
