import { BadRequestException } from '@nestjs/common';

import { KnowledgeAudience, Prisma, ResolutionType } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

describe('KnowledgeRetrievalService', () => {
  const itemRow = {
    type: 'KNOWLEDGE_ITEM' as const,
    score: 0.92,
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
    score: 0.4,
    documentCode: 'DOC_001',
    sectionCode: 'SECTION_001',
    title: 'Password guide',
    content: 'Document content',
    audience: KnowledgeAudience.EMPLOYEE,
    keywords: ['password'],
    media: [],
  };

  const createService = () => {
    const $queryRaw = jest.fn().mockResolvedValueOnce([itemRow]).mockResolvedValueOnce([sectionRow]);
    const service = new KnowledgeRetrievalService({ $queryRaw } as unknown as PrismaService);

    return { service, $queryRaw };
  };

  it('uses audience plus ALL and only searches current published versions', async () => {
    const { service, $queryRaw } = createService();

    await service.search({ query: 'reset password', audience: KnowledgeAudience.EMPLOYEE });

    const itemSql = $queryRaw.mock.calls[0][0] as Prisma.Sql;
    const sectionSql = $queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect((service as any).getAllowedAudiences(KnowledgeAudience.EMPLOYEE)).toEqual([
      KnowledgeAudience.EMPLOYEE,
      KnowledgeAudience.ALL,
    ]);
    expect(itemSql.strings.join('')).toContain('kiv.id = ki.current_published_version_id');
    expect(sectionSql.strings.join('')).toContain('kdv.id = kd.current_published_version_id');
    expect(itemSql.strings.join('')).toContain('kiv.status =');
    expect(sectionSql.strings.join('')).toContain('kdv.status =');
  });

  it('normalizes query, ranks unified results, respects limit, and returns media', async () => {
    const { service } = createService();

    const result = await service.search({
      query: '  reset   password  ',
      audience: KnowledgeAudience.EMPLOYEE,
      limit: 1,
    });

    expect(result).toEqual({
      query: 'reset password',
      results: [
        expect.objectContaining({
          type: 'KNOWLEDGE_ITEM',
          knowledgeCode: 'KB_001',
          media: [{ mediaCode: 'IMG_001', secureUrl: 'https://example.com/image.png', description: 'Guide image' }],
        }),
      ],
    });
  });

  it('returns no results for irrelevant candidates and rejects an empty query', async () => {
    const $queryRaw = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const service = new KnowledgeRetrievalService({ $queryRaw } as unknown as PrismaService);

    await expect(service.search({ query: 'unrelated' })).resolves.toEqual({
      query: 'unrelated',
      results: [],
    });
    await expect(service.search({ query: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
