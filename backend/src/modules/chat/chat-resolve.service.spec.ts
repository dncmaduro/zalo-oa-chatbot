import { InternalServerErrorException, Logger } from '@nestjs/common';

import { KnowledgeAudience, ResolutionType } from '../../generated/prisma/client';
import { LlmService } from '../llm/llm.service';
import { HybridKnowledgeRetrievalService } from '../knowledge/retrieval/hybrid-knowledge-retrieval.service';

import { ChatResolveService } from './chat-resolve.service';
import { ChatRagContextService } from './rag/chat-rag-context.service';

describe('ChatResolveService', () => {
  const fallbackMessage = 'Vui lòng liên hệ bộ phận hỗ trợ để được trợ giúp.';
  const originalFallbackMessage = process.env.CHAT_HUMAN_CONTACT_FALLBACK_MESSAGE;
  const originalPerformanceLogging = process.env.LLM_PERF_LOG;

  const knowledgeItem = (overrides: Record<string, unknown> = {}) => ({
    type: 'KNOWLEDGE_ITEM',
    score: 0.9,
    knowledgeCode: 'ACCOUNT_CREATE_MISSING_INFO',
    title: 'Tạo tài khoản MISA',
    content: 'Nội dung hướng dẫn tạo tài khoản.',
    audience: KnowledgeAudience.EMPLOYEE,
    resolutionType: ResolutionType.AUTO_RESPONSE,
    initialResponse: 'Hướng dẫn ban đầu.',
    requiredFields: [],
    operatorTaskType: null,
    operatorInstruction: null,
    successResponseTemplate: null,
    failureResponseTemplate: null,
    acknowledgementMessage: null,
    humanContactMessage: null,
    keywords: [],
    media: [],
    ...overrides,
  });

  const documentSection = (overrides: Record<string, unknown> = {}) => ({
    type: 'DOCUMENT_SECTION',
    score: 0.8,
    documentCode: 'DOC_ACCOUNT',
    documentTitle: 'Hướng dẫn tài khoản',
    sectionCode: 'SEC_01',
    title: 'Đăng ký',
    content: 'Nội dung section.',
    audience: KnowledgeAudience.EMPLOYEE,
    keywords: [],
    media: [],
    ...overrides,
  });

  const decision = (overrides: Record<string, unknown> = {}) => ({
    selectedKnowledgeItemKey: 'KNOWLEDGE_ITEM:ACCOUNT_CREATE_MISSING_INFO',
    selectedDocumentSectionKey: null,
    supportingDocumentSectionKeys: [],
    collectedFields: {},
    ...overrides,
  });

  const createService = (results: unknown[], modelDecision: unknown) => {
    const hybrid = {
      search: jest.fn().mockResolvedValue({ query: 'message', results }),
    } as unknown as HybridKnowledgeRetrievalService;
    const llm = {
      model: 'qwen3:8b',
      generateStructured: jest.fn().mockResolvedValue(modelDecision),
    } as unknown as LlmService;
    const service = new ChatResolveService(hybrid, new ChatRagContextService(), llm);

    return { service, hybrid, llm };
  };

  beforeEach(() => {
    process.env.CHAT_HUMAN_CONTACT_FALLBACK_MESSAGE = fallbackMessage;
    process.env.LLM_PERF_LOG = 'false';
  });

  afterEach(() => {
    if (originalFallbackMessage === undefined) {
      delete process.env.CHAT_HUMAN_CONTACT_FALLBACK_MESSAGE;
    } else {
      process.env.CHAT_HUMAN_CONTACT_FALLBACK_MESSAGE = originalFallbackMessage;
    }

    if (originalPerformanceLogging === undefined) {
      delete process.env.LLM_PERF_LOG;
    } else {
      process.env.LLM_PERF_LOG = originalPerformanceLogging;
    }

    jest.restoreAllMocks();
  });

  it('does not call the LLM when retrieval has no result and returns the configured human-contact fallback', async () => {
    const { service, llm } = createService([], decision());

    await expect(service.resolve({ message: '  không rõ  ' })).resolves.toMatchObject({
      resolutionType: ResolutionType.HUMAN_CONTACT,
      selectedKnowledge: null,
      response: fallbackMessage,
      model: null,
    });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  it('uses the selected knowledge item route from the KB and ignores model routing fields', async () => {
    const operatorItem = knowledgeItem({
      resolutionType: ResolutionType.OPERATOR_TASK,
      requiredFields: ['Họ tên', 'Số điện thoại', 'Nhà phân phối'],
      operatorTaskType: 'ACCOUNT_CREATE',
      operatorInstruction: 'Tạo tài khoản sau khi kiểm tra thông tin.',
      acknowledgementMessage: 'Đã nhận thông tin, bộ phận phụ trách sẽ xử lý.',
    });
    const { service } = createService(
      [operatorItem],
      decision({
        resolutionType: ResolutionType.AUTO_RESPONSE,
        collectedFields: {
          'Họ tên': 'Nguyễn Văn A',
          'Số điện thoại': '0912345678',
          'Trường không hợp lệ': 'Không được chấp nhận',
        },
      }),
    );

    await expect(service.resolve({ message: 'Tôi là Nguyễn Văn A, số 0912345678' })).resolves.toEqual(
      expect.objectContaining({
        resolutionType: ResolutionType.OPERATOR_TASK,
        response: 'Đã nhận thông tin, bộ phận phụ trách sẽ xử lý.',
        requiredFields: ['Họ tên', 'Số điện thoại', 'Nhà phân phối'],
        collectedFields: {
          'Họ tên': 'Nguyễn Văn A',
          'Số điện thoại': '0912345678',
        },
        missingFields: ['Nhà phân phối'],
        operatorTaskType: 'ACCOUNT_CREATE',
        operatorInstruction: 'Tạo tài khoản sau khi kiểm tra thông tin.',
      }),
    );
  });

  it('keeps uncertain Vietnamese pronouns out of required-field extraction while retaining explicit values', async () => {
    const operatorItem = knowledgeItem({
      resolutionType: ResolutionType.OPERATOR_TASK,
      requiredFields: ['Họ tên', 'Số điện thoại'],
      acknowledgementMessage: 'Đã nhận thông tin, bộ phận phụ trách sẽ xử lý.',
    });
    const pronounResult = await createService(
      [operatorItem],
      decision({ collectedFields: { 'Họ tên': 'Em' } }),
    ).service.resolve({ message: 'Em mới vào công ty chưa có tài khoản MISA thì làm sao?' });

    expect(pronounResult.collectedFields).not.toHaveProperty('Họ tên');
    expect(pronounResult.missingFields).toContain('Họ tên');

    const explicitResult = await createService(
      [operatorItem],
      decision({
        collectedFields: {
          'Họ tên': 'Nguyễn Văn A',
          'Số điện thoại': '0912345678',
        },
      }),
    ).service.resolve({ message: 'Em tên Nguyễn Văn A, số điện thoại 0912345678' });

    expect(explicitResult.collectedFields).toEqual({
      'Họ tên': 'Nguyễn Văn A',
      'Số điện thoại': '0912345678',
    });
    expect(explicitResult.missingFields).toEqual([]);
  });

  it('uses deterministic KB responses for AUTO_RESPONSE, HUMAN_CONTACT, and document-only selections', async () => {
    const autoResponse = await createService(
      [knowledgeItem()],
      decision({ draftResponse: 'LLM output must not be used.' }),
    ).service.resolve({ message: 'Cần tạo tài khoản' });

    expect(autoResponse).toMatchObject({
      resolutionType: ResolutionType.AUTO_RESPONSE,
      response: 'Hướng dẫn ban đầu.',
    });

    const humanItem = knowledgeItem({
      resolutionType: ResolutionType.HUMAN_CONTACT,
      humanContactMessage: 'Vui lòng chờ nhân viên liên hệ.',
    });
    const humanResult = await createService([humanItem], decision()).service.resolve({ message: 'Cần hỗ trợ' });

    expect(humanResult).toMatchObject({
      resolutionType: ResolutionType.HUMAN_CONTACT,
      response: 'Vui lòng chờ nhân viên liên hệ.',
      operatorTaskType: null,
    });

    const humanFallbackResult = await createService(
      [knowledgeItem({ resolutionType: ResolutionType.HUMAN_CONTACT, humanContactMessage: null })],
      decision(),
    ).service.resolve({ message: 'Cần hỗ trợ' });

    expect(humanFallbackResult.response).toBe(fallbackMessage);

    const section = documentSection();
    const sectionResult = await createService(
      [section],
      decision({
        selectedKnowledgeItemKey: null,
        selectedDocumentSectionKey: 'DOCUMENT_SECTION:DOC_ACCOUNT:SEC_01',
      }),
    ).service.resolve({ message: 'Cách đăng ký?' });

    expect(sectionResult).toMatchObject({
      resolutionType: ResolutionType.AUTO_RESPONSE,
      selectedKnowledge: {
        type: 'DOCUMENT_SECTION',
        documentCode: 'DOC_ACCOUNT',
        sectionCode: 'SEC_01',
      },
      response: 'Nội dung section.',
      operatorTaskType: null,
      operatorInstruction: null,
    });
  });

  it('allows a direct KnowledgeItem business rule to beat a higher-ranked related DocumentSection', async () => {
    const activationSection = documentSection({
      documentCode: 'DOC_ACCOUNT_ACTIVATION',
      sectionCode: 'SEC_01',
      title: 'Kích hoạt tài khoản',
      content: 'Hướng dẫn dành cho tài khoản đã tồn tại.',
    });
    const createAccountItem = knowledgeItem({
      title: 'Chưa có tài khoản MISA',
      initialResponse: 'Bộ phận hỗ trợ sẽ hướng dẫn tạo tài khoản.',
    });
    const createAccountSection = documentSection({
      documentCode: 'DOC_ACCOUNT_CREATE',
      sectionCode: 'SEC_01',
      title: 'Tạo tài khoản',
      content: 'Hướng dẫn tạo tài khoản mới.',
    });
    const { service } = createService(
      [activationSection, createAccountSection, createAccountItem],
      decision({
        selectedKnowledgeItemKey: 'KNOWLEDGE_ITEM:ACCOUNT_CREATE_MISSING_INFO',
        selectedDocumentSectionKey: 'DOCUMENT_SECTION:DOC_ACCOUNT_ACTIVATION:SEC_01',
        supportingDocumentSectionKeys: ['DOCUMENT_SECTION:DOC_ACCOUNT_CREATE:SEC_01'],
      }),
    );

    await expect(service.resolve({ message: 'Em chưa có tài khoản MISA thì làm sao?' })).resolves.toMatchObject({
      selectedKnowledge: {
        type: 'KNOWLEDGE_ITEM',
        knowledgeCode: 'ACCOUNT_CREATE_MISSING_INFO',
      },
      response: 'Bộ phận hỗ trợ sẽ hướng dẫn tạo tài khoản.',
      supportingKnowledge: [
        {
          type: 'DOCUMENT_SECTION',
          documentCode: 'DOC_ACCOUNT_CREATE',
          sectionCode: 'SEC_01',
        },
      ],
    });
  });

  it('validates model candidate references, null selection, provider failures, and malformed output', async () => {
    const selectedNone = createService(
      [knowledgeItem()],
      decision({ selectedKnowledgeItemKey: null, selectedDocumentSectionKey: null }),
    );

    await expect(selectedNone.service.resolve({ message: 'Không biết' })).resolves.toMatchObject({
      resolutionType: ResolutionType.HUMAN_CONTACT,
      selectedKnowledge: null,
    });

    const unknownCandidate = createService(
      [knowledgeItem()],
      decision({ selectedKnowledgeItemKey: 'KNOWLEDGE_ITEM:NOT_RETRIEVED' }),
    );
    await expect(unknownCandidate.service.resolve({ message: 'Cần hỗ trợ' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    const wrongKnowledgeItemType = createService(
      [knowledgeItem(), documentSection()],
      decision({ selectedKnowledgeItemKey: 'DOCUMENT_SECTION:DOC_ACCOUNT:SEC_01' }),
    );
    await expect(wrongKnowledgeItemType.service.resolve({ message: 'Cần hỗ trợ' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    const wrongDocumentSectionType = createService(
      [knowledgeItem(), documentSection()],
      decision({
        selectedKnowledgeItemKey: null,
        selectedDocumentSectionKey: 'KNOWLEDGE_ITEM:ACCOUNT_CREATE_MISSING_INFO',
      }),
    );
    await expect(wrongDocumentSectionType.service.resolve({ message: 'Cần hỗ trợ' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    const malformed = createService([knowledgeItem()], {
      selectedKnowledgeItemKey: 'KNOWLEDGE_ITEM:ACCOUNT_CREATE_MISSING_INFO',
    });
    await expect(malformed.service.resolve({ message: 'Cần hỗ trợ' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    const failing = createService([knowledgeItem()], decision());
    (failing.llm.generateStructured as jest.Mock).mockRejectedValue(new Error('LLM unavailable'));
    await expect(failing.service.resolve({ message: 'Cần hỗ trợ' })).rejects.toThrow('LLM unavailable');
  });

  it('retains only valid, unique supporting knowledge and excludes the primary selected key', async () => {
    const selectedItem = knowledgeItem();
    const supportingSection = documentSection();
    const { service } = createService(
      [selectedItem, supportingSection],
      decision({
        supportingDocumentSectionKeys: [
          'DOCUMENT_SECTION:DOC_ACCOUNT:SEC_01',
          'DOCUMENT_SECTION:NOT_RETRIEVED:SEC_99',
          'KNOWLEDGE_ITEM:ACCOUNT_CREATE_MISSING_INFO',
          'DOCUMENT_SECTION:DOC_ACCOUNT:SEC_01',
        ],
      }),
    );

    await expect(service.resolve({ message: 'Cần hỗ trợ' })).resolves.toMatchObject({
      supportingKnowledge: [
        {
          type: 'DOCUMENT_SECTION',
          documentCode: 'DOC_ACCOUNT',
          sectionCode: 'SEC_01',
        },
      ],
    });
  });

  it('passes the requested audience to hybrid retrieval without adding a second audience filter', async () => {
    const customerItem = knowledgeItem({ audience: KnowledgeAudience.CUSTOMER });
    const { service, hybrid } = createService([customerItem], decision());

    await service.resolve({ message: 'Cần trợ giúp', audience: KnowledgeAudience.CUSTOMER });

    expect(hybrid.search).toHaveBeenCalledWith({
      query: 'Cần trợ giúp',
      audience: KnowledgeAudience.CUSTOMER,
      limit: 5,
    });
  });

  it('logs Chat Resolve stage timings only when performance logging is enabled', async () => {
    process.env.LLM_PERF_LOG = 'true';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { service } = createService([knowledgeItem()], decision());

    await service.resolve(
      { message: 'Cần trợ giúp' },
      { conversationId: 'conversation-perf', inboundMessageId: 'inbound-perf' },
    );

    const performanceLog = log.mock.calls
      .map(([message]) => JSON.parse(message as string))
      .find((entry) => entry.event === 'chat_resolve_performance');

    expect(performanceLog).toEqual(
      expect.objectContaining({
        event: 'chat_resolve_performance',
        conversationId: 'conversation-perf',
        inboundMessageId: 'inbound-perf',
        retrievalMs: expect.any(Number),
        ragContextBuildMs: expect.any(Number),
        llmMs: expect.any(Number),
        serverValidationMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
  });
});
