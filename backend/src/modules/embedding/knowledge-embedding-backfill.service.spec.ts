import { PrismaService } from '../../prisma/prisma.service';

import { EmbeddingService } from './embedding.service';
import { KnowledgeEmbeddingBackfillService } from './knowledge-embedding-backfill.service';
import { KnowledgeEmbeddingContentService } from './knowledge-embedding-content.service';

describe('KnowledgeEmbeddingBackfillService', () => {
  const contentService = new KnowledgeEmbeddingContentService();

  const createItem = (overrides: Record<string, unknown> = {}) => ({
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Reset password',
    category: 'Account',
    subCategory: null,
    keywords: ['password', 'reset'],
    exampleQuestions: ['How do I reset my password?'],
    userScenarios: ['User cannot sign in'],
    knowledgeContent: 'Use the reset-password flow.',
    embeddingModel: null,
    embeddingContentHash: null,
    hasEmbedding: false,
    ...overrides,
  });

  const createSection = (overrides: Record<string, unknown> = {}) => ({
    id: '22222222-2222-2222-2222-222222222222',
    documentTitle: 'Account guide',
    sectionTitle: 'Password reset',
    keywords: ['password'],
    content: 'Open the reset-password form.',
    embeddingModel: null,
    embeddingContentHash: null,
    hasEmbedding: false,
    ...overrides,
  });

  function createService(itemRows: unknown[], sectionRows: unknown[]) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce(itemRows).mockResolvedValueOnce(sectionRows),
      $executeRaw: jest.fn().mockResolvedValue(1),
    } as unknown as PrismaService;
    const embeddingService = {
      model: 'test-embedding-model',
      embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as EmbeddingService;

    return {
      prisma,
      embeddingService,
      service: new KnowledgeEmbeddingBackfillService(prisma, embeddingService, contentService),
    };
  }

  it('generates and persists vectors for current published item versions and sections', async () => {
    const { prisma, embeddingService, service } = createService([createItem()], [createSection()]);

    await expect(service.backfill()).resolves.toEqual({
      total: 2,
      generated: 2,
      skipped: 0,
      failed: 0,
    });
    expect(embeddingService.embed).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('skips unchanged vectors when the model and content hash still match', async () => {
    const item = createItem();
    const section = createSection();
    const itemHash = contentService.createContentHash(contentService.buildKnowledgeItemVersionText(item));
    const sectionHash = contentService.createContentHash(contentService.buildKnowledgeDocumentSectionText(section));
    const { prisma, embeddingService, service } = createService(
      [
        createItem({
          hasEmbedding: true,
          embeddingModel: 'test-embedding-model',
          embeddingContentHash: itemHash,
        }),
      ],
      [
        createSection({
          hasEmbedding: true,
          embeddingModel: 'test-embedding-model',
          embeddingContentHash: sectionHash,
        }),
      ],
    );

    await expect(service.backfill()).resolves.toEqual({
      total: 2,
      generated: 0,
      skipped: 2,
      failed: 0,
    });
    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('regenerates only records whose canonical content changed', async () => {
    const originalItem = createItem();
    const section = createSection();
    const originalItemHash = contentService.createContentHash(
      contentService.buildKnowledgeItemVersionText(originalItem),
    );
    const sectionHash = contentService.createContentHash(contentService.buildKnowledgeDocumentSectionText(section));
    const { prisma, embeddingService, service } = createService(
      [
        createItem({
          knowledgeContent: 'Use the newer reset-password flow.',
          hasEmbedding: true,
          embeddingModel: 'test-embedding-model',
          embeddingContentHash: originalItemHash,
        }),
      ],
      [
        createSection({
          hasEmbedding: true,
          embeddingModel: 'test-embedding-model',
          embeddingContentHash: sectionHash,
        }),
      ],
    );

    await expect(service.backfill()).resolves.toEqual({
      total: 2,
      generated: 1,
      skipped: 1,
      failed: 0,
    });
    expect(embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
