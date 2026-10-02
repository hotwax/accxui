// Adapter lifecycle fault injection; real OMS requests are verified separately in POS.
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ request: vi.fn(), setup: vi.fn(), adapter: vi.fn() }));
vi.mock('axios', () => ({ default: Object.assign(state.request, {
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }, create: vi.fn(),
}) }));
vi.mock('axios-cache-adapter', () => ({ setupCache: state.setup }));
vi.mock('../utils/commonUtil', () => ({ commonUtil: { getMaargURL: () => 'https://example.invalid' } }));
vi.mock('../composables/useAuth', () => ({ useAuth: vi.fn() }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  state.request.mockResolvedValue({ status: 200 }); state.setup.mockReturnValue({ adapter: state.adapter });
});
it('does not initialize caching for ordinary requests', async () => {
  const { default: api } = await import('./remoteApi');
  await api({ url: 'ordinary', method: 'get' });
  expect(state.setup).not.toHaveBeenCalled();
  expect(state.request.mock.calls[0][0]).not.toHaveProperty('adapter');
});
it('initializes one adapter for concurrent first cached requests', async () => {
  const { default: api } = await import('./remoteApi');
  await Promise.all([api({ url: 'A', method: 'get', cache: true }), api({ url: 'B', method: 'get', cache: true })]);
  expect(state.setup).toHaveBeenCalledOnce();
  expect(state.request.mock.calls.every(([config]) => config.adapter === state.adapter)).toBe(true);
});
it('allows another cached request to retry a failed initialization', async () => {
  state.setup.mockImplementationOnce(() => { throw new Error('Adapter failed'); });
  const { default: api } = await import('./remoteApi');
  await expect(api({ url: 'A', method: 'get', cache: true })).rejects.toThrow('Adapter failed');
  expect(state.request).not.toHaveBeenCalled();
  await api({ url: 'B', method: 'get', cache: true });
  expect(state.setup).toHaveBeenCalledTimes(2);
  expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ adapter: state.adapter }));
});
