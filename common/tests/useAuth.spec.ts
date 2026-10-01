// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/commonUtil', () => ({ commonUtil: {
  isMoqui: () => true, isAppEmbedded: () => false, getTokenExpiration: () => Date.now() + 3600000,
} }));
vi.mock('../core/logger', () => ({ default: {} }));
vi.mock('../core/i18n', () => ({ translate: (text: string) => text }));
vi.mock('../core/remoteApi', () => ({ default: vi.fn() }));
vi.mock('../store/embeddedApp', () => ({ useEmbeddedAppStore: vi.fn() }));
vi.mock('../utils/appVersionUtil', () => ({ getCanonicalPath: vi.fn() }));

import { useAuth } from '../composables/useAuth';
import { accxuiConfig } from '../core/configRegistry';

describe('Authentication across login sessions', () => {
  const auth = useAuth();
  beforeEach(() => {
    auth.clearAuth();
    auth.updateOMS('demo-test');
    accxuiConfig.value.oms = 'demo-test';
    accxuiConfig.value.current = {};
  });

  it('invalidates an existing auth computed when the user arrives after the token, including re-login', () => {
    const authenticated = auth.isAuthenticated;
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(authenticated.value).toBe(false);
      auth.updateToken('test-token', String(Date.now() + 3600000));
      expect(authenticated.value).toBe(false);
      accxuiConfig.value.current = { userId: 'U1' };
      expect(authenticated.value).toBe(false);
      auth.updateUserId('U1');
      expect(authenticated.value).toBe(true);
      auth.clearAuth();
      accxuiConfig.value.current = {};
      expect(authenticated.value).toBe(false);
    }
  });

  it('still rejects expired tokens and mismatched profiles', () => {
    auth.updateUserId('U1');
    accxuiConfig.value.current = { userId: 'U2' };
    auth.updateToken('test-token', String(Date.now() + 3600000));
    expect(auth.isAuthenticated.value).toBe(false);
    accxuiConfig.value.current = { userId: 'U1' };
    auth.updateToken('test-token', String(Date.now() - 1000));
    expect(auth.isAuthenticated.value).toBe(false);
  });
});
