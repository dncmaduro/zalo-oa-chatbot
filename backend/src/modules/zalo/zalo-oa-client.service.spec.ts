import { ZaloOaClientService, ZaloPermanentError } from './zalo-oa-client.service';
describe('ZaloOaClientService', () => {
  const originalFetch = global.fetch; const originalToken = process.env.ZALO_OA_ACCESS_TOKEN;
  afterEach(() => { global.fetch = originalFetch; process.env.ZALO_OA_ACCESS_TOKEN = originalToken; });
  it('uses the Tin Tư vấn endpoint, access_token header, and exact text payload', async () => {
    process.env.ZALO_OA_ACCESS_TOKEN = 'secret-token'; global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: 0, data: { message_id: 'zalo-msg-1' } }) }) as any;
    await expect(new ZaloOaClientService().sendText('user-1', 'Exact persisted text')).resolves.toEqual({ externalMessageId: 'zalo-msg-1' });
    expect(global.fetch).toHaveBeenCalledWith('https://openapi.zalo.me/v3.0/oa/message/cs', expect.objectContaining({ headers: expect.objectContaining({ access_token: 'secret-token' }), body: JSON.stringify({ recipient: { user_id: 'user-1' }, message: { text: 'Exact persisted text' } }) }));
  });
  it('does not treat an application error in HTTP 200 as success', async () => {
    process.env.ZALO_OA_ACCESS_TOKEN = 'secret-token'; global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: -1, message: 'invalid' }) }) as any;
    await expect(new ZaloOaClientService().sendText('user-1', 'text')).rejects.toBeInstanceOf(ZaloPermanentError);
  });
});
