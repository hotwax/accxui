import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthBypassEndpoint, prepareApiConfig } from './remoteApi';

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: { value: true },
    logout: vi.fn()
  })
}));

describe('prepareApiConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps legacy getPermissions calls on the OFBiz API by default', () => {
    const config = prepareApiConfig({
      url: 'getPermissions',
      method: 'post',
      baseURL: 'https://example.hotwax.io/api/',
      data: { viewIndex: 0, viewSize: 250 }
    });

    expect(config).toMatchObject({
      url: 'getPermissions',
      method: 'post',
      baseURL: 'https://example.hotwax.io/api/',
      data: { viewIndex: 0, viewSize: 250 }
    });
  });

  it('maps getPermissions to the Moqui admin endpoint when Moqui auth is enabled', () => {
    vi.stubEnv('VITE_AUTH_BACKEND', 'moqui');
    vi.stubEnv('VITE_MOQUI_BASE_URL', 'http://localhost:8080');

    const config = prepareApiConfig({
      url: 'getPermissions',
      method: 'post',
      baseURL: 'http://localhost:8080/api/',
      data: { viewIndex: 0, viewSize: 250 }
    });

    expect(config).toMatchObject({
      url: 'admin/user/permissions',
      method: 'get',
      baseURL: 'http://localhost:8080/rest/s1/',
      params: { viewIndex: 0, viewSize: 250 }
    });
    expect(config.data).toBeUndefined();
  });

  it('allows the mapped Moqui permission endpoint during login setup', () => {
    vi.stubEnv('VITE_AUTH_BACKEND', 'moqui');
    vi.stubEnv('VITE_MOQUI_BASE_URL', 'http://localhost:8080');

    const config = prepareApiConfig({
      url: 'getPermissions',
      method: 'post',
      baseURL: 'http://localhost:8080/api/',
      data: { viewIndex: 0, viewSize: 50 }
    });

    expect(config.url).toBe('admin/user/permissions');
    expect(isAuthBypassEndpoint(config.url)).toBe(true);
  });

  it('points legacy OMS-base calls at Moqui REST when Moqui auth is enabled', () => {
    vi.stubEnv('VITE_AUTH_BACKEND', 'moqui');
    vi.stubEnv('VITE_MOQUI_BASE_URL', 'http://localhost:8080');

    const config = prepareApiConfig({
      url: 'ofbiz-oms-usl/checkShippingInventory',
      method: 'post',
      baseURL: 'http://localhost:8080/api/',
      data: { productId: 'SKU-1' }
    });

    expect(config).toMatchObject({
      url: 'ofbiz-oms-usl/checkShippingInventory',
      method: 'post',
      baseURL: 'http://localhost:8080/rest/s1/',
      data: { productId: 'SKU-1' }
    });
  });
});
