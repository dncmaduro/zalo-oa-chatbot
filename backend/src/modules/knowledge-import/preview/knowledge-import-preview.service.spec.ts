import { createHash } from 'crypto';

import { ImportOperation, MediaStatus, MediaType } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ImportStorageService } from '../storage/import-storage.service';
import { KnowledgeImportPreviewService } from './knowledge-import-preview.service';

describe('KnowledgeImportPreviewService canonical snapshots', () => {
  const service = new KnowledgeImportPreviewService({} as PrismaService, {} as ImportStorageService);

  const call = <T>(method: string, ...args: unknown[]): T =>
    (service as unknown as Record<string, (...methodArgs: unknown[]) => T>)[method](...args);

  it('treats an item persisted by Apply as unchanged', () => {
    const afterData = call<Record<string, unknown>>('normalizeKnowledgeItem', {
      knowledgeCode: 'KB_001',
      title: 'Title',
      category: 'Category',
      subCategory: undefined,
      audience: 'CUSTOMER',
      resolutionType: 'AUTO_RESPONSE',
      userScenarios: ['scenario'],
      exampleQuestions: ['question'],
      keywords: ['keyword'],
      knowledgeContent: 'content',
      initialResponse: undefined,
      requiredFields: ['field'],
      operatorTaskType: undefined,
      operatorInstruction: undefined,
      successResponseTemplate: undefined,
      failureResponseTemplate: undefined,
      acknowledgementMessage: undefined,
      humanContactMessage: undefined,
      sourceUrls: ['https://example.com/b', 'https://example.com/a'],
      imageIds: ['IMG_002', 'IMG_001'],
      hasImages: true,
      sourceSheet: 'KNOWLEDGE_ITEMS',
      sourceRow: 2,
      status: 'READY',
    });
    const beforeData = call<Record<string, unknown>>('normalizeExistingKnowledgeItem', 'KB_001', {
      title: 'Title',
      category: 'Category',
      subCategory: null,
      audience: 'CUSTOMER',
      resolutionType: 'AUTO_RESPONSE',
      userScenarios: ['scenario'],
      exampleQuestions: ['question'],
      keywords: ['keyword'],
      knowledgeContent: 'content',
      initialResponse: null,
      requiredFields: ['field'],
      operatorTaskType: null,
      operatorInstruction: null,
      successResponseTemplate: null,
      failureResponseTemplate: null,
      acknowledgementMessage: null,
      humanContactMessage: null,
      sourceSheet: 'KNOWLEDGE_ITEMS',
      sourceRow: 2,
      sources: [{ source: { url: 'https://example.com/a' } }, { source: { url: 'https://example.com/b' } }],
      media: [
        { sortOrder: 0, media: { mediaCode: 'IMG_002' } },
        { sortOrder: 1, media: { mediaCode: 'IMG_001' } },
      ],
    });

    expect(call<ImportOperation>('detectOperation', beforeData, afterData)).toBe(ImportOperation.NO_CHANGE);
  });

  it('uses document-local section ordering in canonical snapshots', () => {
    const afterData = call<Record<string, unknown>>('normalizeKnowledgeDocumentSection', {
      documentCode: 'DOC_001',
      sectionCode: 'SECTION_001',
      sectionTitle: 'Section',
      content: 'content',
      keywords: ['keyword'],
      sourceUrls: ['https://example.com/source'],
      imageIds: ['IMG_001'],
      hasImages: true,
      sourceSheet: 'KNOWLEDGE_DOCUMENTS',
      sourceRow: 2,
      status: 'READY',
    }, 0);
    const beforeData = call<Record<string, unknown>>('normalizeExistingKnowledgeDocumentSection', 'DOC_001', {
      sectionCode: 'SECTION_001',
      sectionTitle: 'Section',
      content: 'content',
      keywords: ['keyword'],
      sortOrder: 0,
      sourceSheet: 'KNOWLEDGE_DOCUMENTS',
      sourceRow: 2,
      sources: [{ source: { url: 'https://example.com/source' } }],
      media: [{ sortOrder: 0, media: { mediaCode: 'IMG_001' } }],
    });

    expect(call<ImportOperation>('detectOperation', beforeData, afterData)).toBe(ImportOperation.NO_CHANGE);
  });

  it('compares media asset bytes by checksum without relation metadata', () => {
    const buffer = Buffer.from('image-bytes');
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const beforeData = call<Record<string, unknown>>('normalizeExistingKnowledgeMedia', {
      mediaCode: 'IMG_001',
      type: MediaType.IMAGE,
      description: 'Image',
      checksum,
      originalFilename: 'IMG_001.png',
      sourceSheet: 'KNOWLEDGE_IMAGES',
      sourceAnchor: 'A2',
      sourceRow: 2,
      status: MediaStatus.READY,
    });
    const afterData = call<Record<string, unknown>>('normalizeKnowledgeMedia', {
      imageId: 'IMG_001',
      knowledgeCode: 'KB_001',
      imageOrder: 99,
      description: 'Image',
      sourceSheet: 'KNOWLEDGE_IMAGES',
      sourceAnchor: 'A2',
      sourceRow: 2,
      status: 'READY',
      extension: 'png',
      buffer,
    });
    const changedAfterData = call<Record<string, unknown>>('normalizeKnowledgeMedia', {
      imageId: 'IMG_001',
      imageOrder: 99,
      description: 'Image',
      sourceSheet: 'KNOWLEDGE_IMAGES',
      sourceAnchor: 'A2',
      sourceRow: 2,
      status: 'READY',
      extension: 'png',
      buffer: Buffer.from('changed-image-bytes'),
    });

    expect(call<ImportOperation>('detectOperation', beforeData, afterData)).toBe(ImportOperation.NO_CHANGE);
    expect(call<ImportOperation>('detectOperation', beforeData, changedAfterData)).toBe(ImportOperation.UPDATE);
  });
});
