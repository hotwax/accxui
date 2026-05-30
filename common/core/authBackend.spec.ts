import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expandMoquiURL,
  getAuthBackend,
  getConfiguredMoquiBaseURL,
  getMoquiBaseURL,
  isMoquiAuthBackend
} from './authBackend';

describe('auth backend config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('defaults to the legacy OFBiz login flow', () => {
    expect(getAuthBackend()).toBe('ofbiz');
    expect(isMoquiAuthBackend()).toBe(false);
  });

  it('enables Moqui auth only when explicitly configured', () => {
    vi.stubEnv('VITE_AUTH_BACKEND', 'moqui');

    expect(getAuthBackend()).toBe('moqui');
    expect(isMoquiAuthBackend()).toBe(true);
  });

  it('expands local Moqui hosts to the rest service base URL', () => {
    expect(expandMoquiURL('localhost:8080')).toBe('http://localhost:8080/rest/s1/');
    expect(expandMoquiURL('http://localhost:8080/api/')).toBe('http://localhost:8080/rest/s1/');
    expect(expandMoquiURL('http://localhost:8080/rest/s1/admin')).toBe('http://localhost:8080/rest/s1/');
  });

  it('uses the configured Moqui base URL for local dev', () => {
    vi.stubEnv('VITE_MOQUI_BASE_URL', 'http://localhost:8080');

    expect(getConfiguredMoquiBaseURL()).toBe('http://localhost:8080/rest/s1/');
  });

  it('uses cookie-backed local Moqui URLs when no env URL is configured', () => {
    vi.stubGlobal('document', {
      cookie: 'maarg=localhost:8080'
    });

    expect(getMoquiBaseURL()).toBe('http://localhost:8080/rest/s1/');
  });
});
