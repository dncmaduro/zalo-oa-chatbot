import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';

const contextFor = (request: any) => ({
  switchToHttp: () => ({ getRequest: () => request }),
  getHandler: () => class Handler {},
  getClass: () => class Controller {},
});

describe('AuthGuard', () => {
  it('attaches the server-resolved operator context for a valid bearer token', async () => {
    const authService = { authenticate: jest.fn().mockResolvedValue({ sessionId: 'session-1', operator: { id: 'operator-1' } }) };
    const guard = new AuthGuard(authService as any);
    const request: any = { headers: { authorization: 'Bearer raw-token' } };

    await expect(guard.canActivate(contextFor(request) as any)).resolves.toBe(true);
    expect(authService.authenticate).toHaveBeenCalledWith('raw-token');
    expect(request.auth).toEqual(expect.objectContaining({ sessionId: 'session-1' }));
  });

  it('rejects missing and invalid bearer tokens with 401', async () => {
    const guard = new AuthGuard({ authenticate: jest.fn() } as any);
    await expect(guard.canActivate(contextFor({ headers: {} }) as any)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(contextFor({ headers: { authorization: 'Basic nope' } }) as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('PermissionsGuard', () => {
  it('allows only server-resolved permissions and rejects spoofed/missing permissions', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['task.assign']) };
    const guard = new PermissionsGuard(reflector as any);

    expect(guard.canActivate(contextFor({ auth: { operator: { permissions: ['task.assign'] } } }) as any)).toBe(true);
    expect(() => guard.canActivate(contextFor({ auth: { operator: { permissions: ['task.update'] } } }) as any)).toThrow(
      ForbiddenException,
    );
  });
});
