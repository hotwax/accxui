// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  sessionToken: vi.fn(), getState: vi.fn(), api: vi.fn(),
  updateToken: vi.fn(), updateOMS: vi.fn(),
  store: { $reset: vi.fn(), $patch: vi.fn() },
}));
vi.mock('@shopify/app-bridge', () => ({ createApp: () => ({getState:mocks.getState}) }));
vi.mock('@shopify/app-bridge-utils', () => ({ getSessionToken: mocks.sessionToken }));
vi.mock('../core/remoteApi', () => ({default:mocks.api}));
vi.mock('../store/embeddedApp', () => ({useEmbeddedAppStore: () => mocks.store}));
vi.mock('../composables/useAuth', () => ({useAuth: () => ({updateToken:mocks.updateToken,updateOMS:mocks.updateOMS})}));
vi.mock('../core/configRegistry', () => ({accxuiConfig:{value:{oms:''}}}));
import { useShopify } from '../composables/useShopify';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_SHOPIFY_SHOP_CONFIG', JSON.stringify({'test.myshopify.com':{apiKey:'test-public-key',maarg:'https://test.invalid'}}));
});

it('requests the token and current POS context together, then authenticates with both', async () => {
  let tokenReady!: (value: string) => void, contextReady!: (value: any) => void;
  mocks.sessionToken.mockReturnValueOnce(new Promise(resolve => { tokenReady = resolve; }));
  mocks.getState.mockReturnValueOnce(new Promise(resolve => { contextReady = resolve; }));
  mocks.api.mockResolvedValueOnce({data:{token:'test-token',omsInstanceUrl:'test',expiresAt:1}});
  const login = useShopify().appBridgeLogin('test.myshopify.com','test-host');
  await vi.waitFor(() => expect(mocks.getState).toHaveBeenCalledOnce());
  expect(mocks.sessionToken).toHaveBeenCalledOnce();
  expect(mocks.api).not.toHaveBeenCalled();
  tokenReady('test-session');
  await Promise.resolve();
  expect(mocks.api).not.toHaveBeenCalled();
  contextReady({pos:{location:{id:'LOCATION'},user:{firstName:'Test'}}});
  expect(await login).toBe(true);
  expect(mocks.api).toHaveBeenCalledWith(expect.objectContaining({data:{sessionToken:'test-session',locationId:'LOCATION',firstName:'Test'}}));
});

it('does not authenticate or update the session when POS context fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.sessionToken.mockResolvedValueOnce('test-session');
  mocks.getState.mockRejectedValueOnce(new Error('Bridge unavailable'));
  expect(await useShopify().appBridgeLogin('test.myshopify.com','test-host')).toBe(false);
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.updateToken).not.toHaveBeenCalled();
  log.mockRestore();
});
