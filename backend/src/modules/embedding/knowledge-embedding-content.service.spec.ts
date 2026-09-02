import { KnowledgeEmbeddingContentService } from './knowledge-embedding-content.service';

describe('KnowledgeEmbeddingContentService', () => {
  const service = new KnowledgeEmbeddingContentService();

  it('builds deterministic canonical text for a knowledge item version', () => {
    const text = service.buildKnowledgeItemVersionText({
      title: '  Quên\n mật khẩu MISA  ',
      category: ' Tài khoản ',
      subCategory: ' Đăng nhập ',
      keywords: ['misa', ' quên mật khẩu ', 'misa'],
      exampleQuestions: [' Tôi quên mật khẩu MISA ', 'Làm sao lấy lại mật khẩu'],
      userScenarios: [' Người dùng\nkhông đăng nhập được '],
      knowledgeContent: '  Hướng dẫn\n lấy lại mật khẩu. ',
    });

    expect(text).toBe(
      [
        'Title: Quên mật khẩu MISA',
        'Category: Tài khoản',
        'Subcategory: Đăng nhập',
        'Keywords:',
        '- misa',
        '- quên mật khẩu',
        'Example Questions:',
        '- Tôi quên mật khẩu MISA',
        '- Làm sao lấy lại mật khẩu',
        'User Scenarios:',
        '- Người dùng không đăng nhập được',
        'Content: Hướng dẫn lấy lại mật khẩu.',
      ].join('\n'),
    );
  });

  it('uses the current document title and produces a lowercase SHA-256 hash', () => {
    const text = service.buildKnowledgeDocumentSectionText({
      documentTitle: '  Hướng dẫn sản phẩm ',
      sectionTitle: '  Cài đặt ',
      keywords: ['thiết lập', 'cài đặt'],
      content: ' Nội dung\n phần cài đặt ',
    });

    expect(text).toBe(
      [
        'Document Title: Hướng dẫn sản phẩm',
        'Section Title: Cài đặt',
        'Keywords:',
        '- cài đặt',
        '- thiết lập',
        'Content: Nội dung phần cài đặt',
      ].join('\n'),
    );
    expect(service.createContentHash(text)).toMatch(/^[0-9a-f]{64}$/);
  });
});
