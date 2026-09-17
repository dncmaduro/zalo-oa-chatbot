import { createHash } from 'node:crypto';
import { ZaloSignatureService } from './zalo-signature.service';

describe('ZaloSignatureService diagnostics', () => {
  const original = { app: process.env.ZALO_APP_ID, secret: process.env.ZALO_OA_SECRET_KEY };
  const raw = Buffer.from('{"event_name":"user_send_text"}');
  const timestamp = '1720000000';
  const signature = () => createHash('sha256').update(`app-1${raw.toString()}${timestamp}secret-1`).digest('hex');
  const service = new ZaloSignatureService();

  beforeEach(() => { process.env.ZALO_APP_ID = 'app-1'; process.env.ZALO_OA_SECRET_KEY = 'secret-1'; });
  afterAll(() => { process.env.ZALO_APP_ID = original.app; process.env.ZALO_OA_SECRET_KEY = original.secret; });

  it.each([
    ['malformed signature', raw, timestamp, 'sha256=invalid', undefined, 'invalid_signature_format'],
    ['invalid timestamp', raw, undefined, signature(), undefined, 'invalid_timestamp'],
    ['invalid payload app ID', raw, timestamp, signature(), 123, 'invalid_payload_app_id'],
    ['mismatched payload app ID', raw, timestamp, signature(), 'app-2', 'app_id_mismatch'],
    ['wrong digest', raw, timestamp, '0'.repeat(64), undefined, 'digest_mismatch'],
  ] as const)('reports %s', (_, testRaw, testTimestamp, testSignature, payloadAppId, reason) => {
    expect(service.verifyDetailed(testRaw, testTimestamp, testSignature, payloadAppId)).toEqual({ valid: false, reason });
  });

  it('reports a valid request', () => {
    expect(service.verifyDetailed(raw, timestamp, signature())).toEqual({ valid: true, reason: 'valid' });
  });
});
