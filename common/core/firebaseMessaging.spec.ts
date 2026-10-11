import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ supported: vi.fn(), initialize: vi.fn(), token: vi.fn(), messaging: vi.fn(), onMessage: vi.fn(), permission: vi.fn() }));
vi.mock('firebase/app', () => ({ initializeApp: state.initialize }));
vi.mock('firebase/messaging', () => ({ isSupported: state.supported, getMessaging: state.messaging, getToken: state.token, onMessage: state.onMessage }));
vi.mock('./logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
import { firebaseMessaging } from './firebaseMessaging';
beforeEach(() => {
  vi.clearAllMocks(); state.supported.mockResolvedValue(true); state.token.mockResolvedValue('unit-token');
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: state.permission });
  vi.stubGlobal('BroadcastChannel', class { onmessage: unknown; });
});
it('does not initialize or request permission on unsupported surfaces', async () => {
  state.supported.mockResolvedValueOnce(false);
  expect(await firebaseMessaging.initialiseFirebaseApp({}, 'unit-key', vi.fn(), vi.fn())).toEqual({ status: 'unsupported' });
  expect(state.initialize).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
});
it('keeps granted permission and waits for registration before installing listeners', async () => {
  let resolve!: () => void;
  const registration = new Promise<void>(done => { resolve = done; });
  const register = vi.fn().mockReturnValue(registration);
  const work = firebaseMessaging.initialiseFirebaseApp({}, 'unit-key', register, vi.fn());
  await vi.waitFor(() => expect(register).toHaveBeenCalledWith('unit-token'));
  expect(state.permission).not.toHaveBeenCalled(); expect(state.onMessage).not.toHaveBeenCalled();
  resolve(); expect(await work).toEqual({ status: 'token' }); expect(state.onMessage).toHaveBeenCalledOnce();
});
it('does not fetch a token after permission is refused', async () => {
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: state.permission });
  state.permission.mockResolvedValueOnce('denied');
  expect(await firebaseMessaging.initialiseFirebaseApp({}, 'unit-key', vi.fn(), vi.fn())).toEqual({ status: 'permission', permission: 'denied' });
  expect(state.token).not.toHaveBeenCalled(); expect(state.onMessage).not.toHaveBeenCalled();
});
