import { describe, expect, it } from 'vitest';
import { REDACTED, RedactSensitiveDataHook, sanitizeForLog } from '../core/logRedaction';

/** The exact token seen leaking from a 400 on oms/orders/110879/fulfillmentTimeline. */
const TOKEN = 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3ODc0MzQ5NDEsInVzZXJMb2dpbklkIjoiYWRpdHlhLnBhdGVsIn0.nseV_rrCuALmHuEv79d92UjxuMltZpHPg4biQeKLKAej';

/** Shaped like what axios 0.21 `enhanceError` hands to a rejected request. */
function axiosError() {
  const error: any = new Error('Request failed with status code 400');
  error.name = 'Error';
  error.isAxiosError = true;
  error.code = undefined;
  error.config = {
    url: 'oms/orders/110879/fulfillmentTimeline',
    method: 'get',
    baseURL: 'https://rails-oms.hotwax.io/rest/s1/',
    headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN'
  };
  error.response = { status: 400, statusText: 'Bad Request', data: { errors: 'No timeline' } };
  // The leak vector: StringifyObjectsHook calls JSON.stringify, which calls this.
  error.toJSON = function toJSON() {
    return { message: this.message, name: this.name, stack: this.stack, config: this.config, code: this.code };
  };
  return error;
}

describe('sanitizeForLog', () => {
  it('keeps a bearer token out of anything the logger would print', () => {
    const printed = JSON.stringify(sanitizeForLog(axiosError()));

    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain('Bearer');
    // The unsanitised error really does leak it, or this test proves nothing.
    expect(JSON.stringify(axiosError())).toContain(TOKEN);
  });

  it('still says what failed, where, and what came back', () => {
    const safe: any = sanitizeForLog(axiosError());

    expect(safe.message).toBe('Request failed with status code 400');
    expect(safe.method).toBe('GET');
    expect(safe.url).toBe('oms/orders/110879/fulfillmentTimeline');
    expect(safe.baseURL).toBe('https://rails-oms.hotwax.io/rest/s1/');
    expect(safe.status).toBe(400);
    expect(safe.statusText).toBe('Bad Request');
    expect(safe.responseData).toEqual({ errors: 'No timeline' });
    expect(safe.stack).toContain('Error');
  });

  it('drops the request headers rather than trusting itself to redact each one', () => {
    expect(sanitizeForLog(axiosError())).not.toHaveProperty('config');
    expect(sanitizeForLog(axiosError())).not.toHaveProperty('headers');
  });

  it('redacts a credential wherever it sits, not only in a request header', () => {
    const safe: any = sanitizeForLog({
      headers: { authorization: `Bearer ${TOKEN}`, 'X-XSRF-Token': 'abc', Accept: 'application/json' },
      body: { access_token: TOKEN, refreshToken: TOKEN, password: 'hunter2', userLoginId: 'aditya.patel' }
    });

    expect(safe.headers.authorization).toBe(REDACTED);
    expect(safe.headers['X-XSRF-Token']).toBe(REDACTED);
    expect(safe.headers.Accept).toBe('application/json');
    expect(safe.body.access_token).toBe(REDACTED);
    expect(safe.body.refreshToken).toBe(REDACTED);
    expect(safe.body.password).toBe(REDACTED);
    // Redaction is about credentials, not about hiding everything.
    expect(safe.body.userLoginId).toBe('aditya.patel');
  });

  it('redacts a credential smuggled through a query string', () => {
    const error = axiosError();
    error.config.url = `oms/orders?orderId=110879&token=${TOKEN}&pageSize=10`;
    const safe: any = sanitizeForLog(error);

    expect(safe.url).toBe(`oms/orders?orderId=110879&token=${REDACTED}&pageSize=10`);
    expect(JSON.stringify(safe)).not.toContain(TOKEN);
  });

  it('catches a rethrown axios shape that lost its isAxiosError flag', () => {
    const error = axiosError();
    delete error.isAxiosError;

    expect(JSON.stringify(sanitizeForLog(error))).not.toContain(TOKEN);
  });

  it('reads a plain Error better than JSON.stringify does', () => {
    // JSON.stringify(new Error('boom')) is "{}" — every non-axios error logged today is blank.
    expect(JSON.stringify(new Error('boom'))).toBe('{}');

    const safe: any = sanitizeForLog(new Error('boom'));
    expect(safe.message).toBe('boom');
    expect(safe.name).toBe('Error');
  });

  it('leaves values that are not objects alone', () => {
    expect(sanitizeForLog('Failed to load fulfillment timeline')).toBe('Failed to load fulfillment timeline');
    expect(sanitizeForLog(400)).toBe(400);
    expect(sanitizeForLog(null)).toBe(null);
    expect(sanitizeForLog(undefined)).toBe(undefined);
  });

  it('survives a self-referencing object instead of hanging the log call', () => {
    const cyclic: any = { name: 'outer', token: TOKEN };
    cyclic.self = cyclic;
    const safe: any = sanitizeForLog(cyclic);

    expect(safe.token).toBe(REDACTED);
    expect(safe.self).toBe('[circular]');
    expect(() => JSON.stringify(safe)).not.toThrow();
  });

  it('bottoms out on a deeply nested object', () => {
    let deep: any = { token: TOKEN };
    for (let level = 0; level < 12; level++) deep = { nested: deep };

    expect(JSON.stringify(sanitizeForLog(deep))).not.toContain(TOKEN);
    expect(JSON.stringify(sanitizeForLog(deep))).toContain('[truncated]');
  });
});

describe('RedactSensitiveDataHook', () => {
  it('sanitises every argument the logger was handed, in place', () => {
    const event = { level: 'error' as const, argumentArray: ['Failed to load fulfillment timeline', axiosError()] };
    RedactSensitiveDataHook.run(event);

    expect(event.argumentArray[0]).toBe('Failed to load fulfillment timeline');
    expect(JSON.stringify(event.argumentArray)).not.toContain(TOKEN);
  });
});
