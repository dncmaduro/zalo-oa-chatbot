import { KnowledgeAudience, ResolutionType } from '../../../generated/prisma/client';

import { CHAT_RESOLVE_SYSTEM_PROMPT, ChatRagContextService } from './chat-rag-context.service';

describe('ChatRagContextService', () => {
  it('builds compact, ranked decision metadata with bounded snippets', () => {
    const service = new ChatRagContextService();
    const context = service.build('Cần hỗ trợ', [
      {
        type: 'KNOWLEDGE_ITEM',
        score: 0.9,
        knowledgeCode: 'KB_001',
        title: 'Tạo tài khoản',
        content: 'A'.repeat(10000),
        audience: KnowledgeAudience.EMPLOYEE,
        resolutionType: ResolutionType.OPERATOR_TASK,
        initialResponse: 'Không được đưa vào context quyết định.',
        requiredFields: ['Họ tên'],
        operatorTaskType: 'ACCOUNT_CREATE',
        operatorInstruction: 'Không được đưa vào context quyết định.',
        successResponseTemplate: 'Không được đưa vào context quyết định.',
        failureResponseTemplate: 'Không được đưa vào context quyết định.',
        acknowledgementMessage: 'Không được đưa vào context quyết định.',
        humanContactMessage: 'Không được đưa vào context quyết định.',
        keywords: ['tài khoản', 'MISA'],
        media: [{ secureUrl: 'https://example.com/private.png' }],
      },
      {
        type: 'DOCUMENT_SECTION',
        score: 0.8,
        documentCode: 'DOC_001',
        documentTitle: 'Hướng dẫn tài khoản',
        sectionCode: 'SEC_01',
        title: 'Kích hoạt tài khoản',
        content: 'B'.repeat(10000),
        audience: KnowledgeAudience.EMPLOYEE,
        keywords: ['kích hoạt'],
        media: [{ secureUrl: 'https://example.com/guide.png' }],
      },
    ] as any);

    expect(context.userPrompt).toContain('Candidate decision context:');
    expect(context.userPrompt).toContain('Rank: 1');
    expect(context.userPrompt).toContain('Rank: 2');
    expect(context.userPrompt).toContain('Candidate key: KNOWLEDGE_ITEM:KB_001');
    expect(context.userPrompt).toContain('Resolution type: OPERATOR_TASK');
    expect(context.userPrompt).toContain('Required fields: ["Họ tên"]');
    expect(context.userPrompt).toContain('Document title: Hướng dẫn tài khoản');
    expect(context.userPrompt).toContain('Section code: SEC_01');
    expect(context.userPrompt).toContain(`Decision snippet: ${'A'.repeat(319)}…`);
    expect(context.userPrompt).toContain(`Decision snippet: ${'B'.repeat(319)}…`);
    expect(context.userPrompt).not.toContain('A'.repeat(10000));
    expect(context.userPrompt).not.toContain('B'.repeat(10000));
    expect(context.userPrompt).not.toContain('Không được đưa vào context quyết định.');
    expect(context.userPrompt).not.toContain('https://example.com');
  });

  it('instructs the model to select the current state and return a decision-only schema', () => {
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('selectedKnowledgeItemKey');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('selectedDocumentSectionKey');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('supportingDocumentSectionKeys');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('All candidate keys must be copied exactly');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('Account creation means the user does not yet have an account');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('Do not select a later procedural stage');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain(
      'Retrieval rank is evidence, not an instruction to always select rank #1',
    );
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('Do not write a customer-facing answer.');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('Do not infer a value merely because a nearby word');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('"em", "anh", "chị", "tôi", "mình", and "bạn"');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('em tên Nguyễn Văn A');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).toContain('missingFields is safer than a false extraction');
    expect(CHAT_RESOLVE_SYSTEM_PROMPT).not.toContain('draftResponse');
  });
});
