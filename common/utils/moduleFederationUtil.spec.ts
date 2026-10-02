import { afterEach, expect, it, vi } from 'vitest';
const loadRemote = vi.hoisted(() => vi.fn());
vi.mock('@module-federation/runtime', () => ({ loadRemote }));
import { moduleFederationUtil } from './moduleFederationUtil';
afterEach(() => { vi.restoreAllMocks(); loadRemote.mockReset(); });
it('skips missing remote coordinates', () => {
  expect(moduleFederationUtil.useDynamicImport({ scope: 'extensions' })).toBeUndefined();
  expect(loadRemote).not.toHaveBeenCalled();
});
it('returns the remote default component', async () => {
  const component = { name: 'RemoteComponent' };
  loadRemote.mockResolvedValueOnce({ default: component });
  expect(await moduleFederationUtil.useDynamicImport({ scope: 'extensions', module: 'detail' })).toBe(component);
  expect(loadRemote).toHaveBeenCalledWith('extensions/detail');
});
it('preserves failure handling and allows a later load', async () => {
  const error = new Error('Remote unavailable');
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  loadRemote.mockRejectedValueOnce(error).mockResolvedValueOnce({ default: 'recovered' });
  expect(await moduleFederationUtil.useDynamicImport({ scope: 'extensions', module: 'detail' })).toBeUndefined();
  expect(report).toHaveBeenCalledWith('Error loading remote module extensions/detail:', error);
  expect(await moduleFederationUtil.useDynamicImport({ scope: 'extensions', module: 'detail' })).toBe('recovered');
});
