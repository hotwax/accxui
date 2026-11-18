// @vitest-environment jsdom
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { appUpdatePwaOptions } from '../vite/appUpdatePwa';

const mocks = vi.hoisted(() => ({ register: vi.fn(), showToast: vi.fn(), present: vi.fn() }));

vi.mock('register-service-worker', () => ({ register: mocks.register }));
vi.mock('../utils/commonUtil', () => ({ commonUtil: { showToast: mocks.showToast } }));
vi.mock('../core/i18n', () => ({ translate: (key: string) => key }));
vi.mock('../core/logger', () => ({ default: { error: vi.fn() } }));

type Worker = { state: string; postMessage: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> };
const worker = (state = 'installed'): Worker => ({ state, postMessage: vi.fn(), addEventListener: vi.fn() });

let registration: { update: ReturnType<typeof vi.fn>; waiting: Worker | null; installing: Worker | null; active: Worker | null };
let controller: object | null;
let swListeners: Record<string, () => void>;
let reload: ReturnType<typeof vi.fn>;

const loadComposable = async () => {
  vi.resetModules();
  const { useAppUpdate } = await import('../composables/useAppUpdate');

  return useAppUpdate();
};

// The hooks the composable passed to register-service-worker
const hooks = () => mocks.register.mock.calls[0][1];

beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('BASE_URL', '/');
  // A returning visit: the current build's worker is active
  registration = { update: vi.fn(() => Promise.resolve()), waiting: null, installing: null, active: worker('activated') };
  controller = { id: 'current' };
  swListeners = {};
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      get controller() { return controller; },
      addEventListener: vi.fn((name: string, listener: () => void) => { swListeners[name] = listener; })
    }
  });
  reload = vi.fn();
  vi.stubGlobal('location', { reload });
  // manualDismiss: showToast hands the toast back unpresented
  mocks.showToast.mockResolvedValue({ present: mocks.present });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useAppUpdate', () => {
  it('registers sw.js under the base without the HTTP cache', async () => {
    const { startAppUpdateWatch } = await loadComposable();

    startAppUpdateWatch();
    expect(mocks.register).toHaveBeenCalledWith('/sw.js', expect.objectContaining({
      registrationOptions: { scope: '/', updateViaCache: 'none' }
    }));
  });

  it('registers once however often it is started', async () => {
    const { startAppUpdateWatch } = await loadComposable();

    startAppUpdateWatch();
    startAppUpdateWatch();
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside a production build', async () => {
    // An empty string: this Vitest version stores false as the truthy string "false"
    vi.stubEnv('PROD', '');
    const { startAppUpdateWatch } = await loadComposable();

    startAppUpdateWatch();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('offers the update when a new worker is waiting', async () => {
    const { startAppUpdateWatch, updateAvailable } = await loadComposable();

    startAppUpdateWatch();
    hooks().updated(registration);
    await flushPromises();
    expect(updateAvailable.value).toBe(true);
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.showToast.mock.calls[0];

    expect(message).toBe('New version available, click update to get latest version');
    // Stays until the user acts, with the shared Dismiss button plus Update
    expect(options).toMatchObject({ manualDismiss: true, canDismiss: true });
    expect(options.buttons.map((button: { text: string }) => button.text)).toEqual(['Update']);
    expect(mocks.present).toHaveBeenCalled();
    // Its Update applies the update (nothing waiting here, so a plain reload)
    options.buttons[0].handler();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the prompt to the app when showToast is false', async () => {
    const { startAppUpdateWatch, updateAvailable } = await loadComposable();

    startAppUpdateWatch({ showToast: false });
    hooks().updated(registration);
    await flushPromises();
    expect(updateAvailable.value).toBe(true);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('catches a worker the page load found that is still installing at registration', async () => {
    const installing = worker('installing');

    registration.installing = installing;
    const { startAppUpdateWatch, updateAvailable } = await loadComposable();

    startAppUpdateWatch();
    hooks().registered(registration);
    expect(updateAvailable.value).toBe(false);
    installing.state = 'installed';
    installing.addEventListener.mock.calls[0][1]();
    expect(updateAvailable.value).toBe(true);
  });

  it('does not offer an update for the first install', async () => {
    controller = null;
    registration.active = null;
    registration.installing = worker('installing');
    const { startAppUpdateWatch, updateAvailable } = await loadComposable();

    startAppUpdateWatch();
    hooks().registered(registration);
    expect(registration.installing.addEventListener).not.toHaveBeenCalled();
    hooks().cached(registration);
    expect(updateAvailable.value).toBe(false);
  });

  it('offers the update in a tab from the first visit, which the library reports as cached', async () => {
    // That tab has no controller, but the previous build's worker is active
    controller = null;
    const { startAppUpdateWatch, updateAvailable } = await loadComposable();

    startAppUpdateWatch();
    hooks().cached(registration);
    expect(updateAvailable.value).toBe(true);
  });

  it('checks a tab left open once an hour', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const { startAppUpdateWatch } = await loadComposable();

    startAppUpdateWatch();
    hooks().registered(registration);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  // The worker moves to "activating", then "activated"; only the second one reloads.
  const activate = (waiting: Worker) => {
    const onStateChange = waiting.addEventListener.mock.calls.find(([name]) => name === 'statechange')[1];

    waiting.state = 'activating';
    onStateChange();
    expect(reload).not.toHaveBeenCalled();
    waiting.state = 'activated';
    onStateChange();
  };

  it('activates the waiting worker on Update and reloads once it is active', async () => {
    const waiting = worker();

    registration.waiting = waiting;
    const { startAppUpdateWatch, applyUpdate } = await loadComposable();

    startAppUpdateWatch();
    hooks().updated(registration);
    applyUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    activate(waiting);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads a tab no worker controls too (first visit, hard refresh), which gets no controllerchange', async () => {
    controller = null;
    const waiting = worker();

    registration.waiting = waiting;
    const { startAppUpdateWatch, applyUpdate } = await loadComposable();

    startAppUpdateWatch();
    hooks().cached(registration);
    applyUpdate();
    expect(swListeners.controllerchange).toBeUndefined();
    activate(waiting);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('just reloads when no worker is waiting any more (another tab applied it)', async () => {
    const { startAppUpdateWatch, applyUpdate } = await loadComposable();

    startAppUpdateWatch();
    hooks().updated(registration);
    applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('appUpdatePwaOptions', () => {
  it('builds the framework worker as sw.js without injecting a register script', () => {
    const manifest = { name: 'App' };
    const options = appUpdatePwaOptions({ manifest });

    expect(options).toMatchObject({
      strategies: 'injectManifest',
      filename: 'sw.ts',
      injectRegister: false,
      includeManifestIcons: false,
      injectManifest: { globPatterns: ['index.html'] },
      manifest
    });
    expect(path.join(options.srcDir, options.filename)).toBe(path.resolve(__dirname, '../pwa/sw.ts'));
  });

  it('points at a worker that caches nothing, waits for SKIP_WAITING and keeps the injection point', () => {
    const source = readFileSync(path.resolve(__dirname, '../pwa/sw.ts'), 'utf-8');

    expect(source).toContain('self as any).__WB_MANIFEST');
    expect(source).toContain('SKIP_WAITING');
    expect(source).not.toMatch(/addEventListener\(["'](fetch|install)["']/);
    expect(source).not.toMatch(/caches\./);
  });
});
