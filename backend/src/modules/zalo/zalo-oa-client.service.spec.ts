import { ZaloOaClientService, ZaloPermanentError } from './zalo-oa-client.service';

describe('ZaloOaClientService', () => {
  const originalFetch = global.fetch;
  const tokens = { getValidAccessToken: jest.fn(), refreshAfterAuthFailure: jest.fn() };
  const service = new ZaloOaClientService(tokens as any);

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('gets a DB-backed token and uses the Tin Tư vấn endpoint and exact text payload', async () => {
    tokens.getValidAccessToken.mockResolvedValue('db-token');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: 0, data: { message_id: 'zalo-msg-1' } }) }) as any;
    await expect(service.sendText('user-1', 'Exact persisted text')).resolves.toEqual({ externalMessageId: 'zalo-msg-1' });
    expect(global.fetch).toHaveBeenCalledWith('https://openapi.zalo.me/v3.0/oa/message/cs', expect.objectContaining({ headers: expect.objectContaining({ access_token: 'db-token' }), body: JSON.stringify({ recipient: { user_id: 'user-1' }, message: { text: 'Exact persisted text' } }) }));
    expect(tokens.refreshAfterAuthFailure).not.toHaveBeenCalled();
  });

  it.each([-216, -220])('refreshes once and retries once for Zalo authentication error %s', async (error) => {
    tokens.getValidAccessToken.mockResolvedValue('old-token');
    tokens.refreshAfterAuthFailure.mockResolvedValue('new-token');
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error: 0, data: { message_id: 'new-message' } }) }) as any;
    await expect(service.sendText('user-1', 'text')).resolves.toEqual({ externalMessageId: 'new-message' });
    expect(tokens.refreshAfterAuthFailure).toHaveBeenCalledWith('old-token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('stops after the single authentication retry', async () => {
    tokens.getValidAccessToken.mockResolvedValue('old-token');
    tokens.refreshAfterAuthFailure.mockResolvedValue('new-token');
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error: -216 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error: -220 }) }) as any;
    await expect(service.sendText('user-1', 'text')).rejects.toBeInstanceOf(ZaloPermanentError);
    expect(tokens.refreshAfterAuthFailure).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not refresh for unrelated Zalo application errors', async () => {
    tokens.getValidAccessToken.mockResolvedValue('db-token');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: -1, message: 'invalid' }) }) as any;
    await expect(service.sendText('user-1', 'text')).rejects.toBeInstanceOf(ZaloPermanentError);
    expect(tokens.refreshAfterAuthFailure).not.toHaveBeenCalled();
  });
});
