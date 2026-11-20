// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initialiseConfig, unregisterLegacyServiceWorkers, accxuiConfig } from '../core/configRegistry'

describe('configRegistry & unregisterLegacyServiceWorkers', () => {
  const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (originalServiceWorkerDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorkerDescriptor)
    } else {
      // @ts-expect-error cleanup mock
      delete navigator.serviceWorker
    }
  })

  it('unregisters legacy PWA service workers within the current app scope', async () => {
    const unregister1 = vi.fn().mockResolvedValue(true)
    const unregister2 = vi.fn().mockResolvedValue(true)
    const fakeRegistrations = [
      {
        scope: window.location.origin + '/',
        active: { scriptURL: window.location.origin + '/sw.js' },
        unregister: unregister1
      },
      {
        scope: window.location.origin + '/',
        active: { scriptURL: window.location.origin + '/service-worker.js' },
        unregister: unregister2
      }
    ]

    const getRegistrations = vi.fn().mockResolvedValue(fakeRegistrations)

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistrations },
      configurable: true,
      writable: true
    })

    await unregisterLegacyServiceWorkers()

    expect(getRegistrations).toHaveBeenCalledTimes(1)
    expect(unregister1).toHaveBeenCalledTimes(1)
    expect(unregister2).toHaveBeenCalledTimes(1)
  })

  it('preserves Firebase Messaging push workers during cleanup', async () => {
    const pwaUnregister = vi.fn().mockResolvedValue(true)
    const fcmUnregister = vi.fn().mockResolvedValue(true)
    const fcmScopeUnregister = vi.fn().mockResolvedValue(true)

    const fakeRegistrations = [
      {
        scope: window.location.origin + '/',
        active: { scriptURL: window.location.origin + '/sw.js' },
        unregister: pwaUnregister
      },
      {
        scope: window.location.origin + '/',
        active: { scriptURL: window.location.origin + '/firebase-messaging-sw.js' },
        unregister: fcmUnregister
      },
      {
        scope: window.location.origin + '/firebase-cloud-messaging-push-scope',
        active: { scriptURL: window.location.origin + '/push-worker.js' },
        unregister: fcmScopeUnregister
      }
    ]

    const getRegistrations = vi.fn().mockResolvedValue(fakeRegistrations)

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistrations },
      configurable: true,
      writable: true
    })

    await unregisterLegacyServiceWorkers()

    expect(pwaUnregister).toHaveBeenCalledTimes(1)
    expect(fcmUnregister).not.toHaveBeenCalled()
    expect(fcmScopeUnregister).not.toHaveBeenCalled()
  })

  it('preserves service workers from other path-scoped applications on the same origin', async () => {
    const otherAppUnregister = vi.fn().mockResolvedValue(true)

    // Current window is at origin root or whatever jsdom defaults to (e.g. http://localhost:3000/)
    const fakeRegistrations = [
      {
        scope: window.location.origin + '/other-app/',
        active: { scriptURL: window.location.origin + '/other-app/sw.js' },
        unregister: otherAppUnregister
      }
    ]

    const getRegistrations = vi.fn().mockResolvedValue(fakeRegistrations)

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistrations },
      configurable: true,
      writable: true
    })

    await unregisterLegacyServiceWorkers('/my-app/')

    expect(otherAppUnregister).not.toHaveBeenCalled()
  })

  it('runs unregisterLegacyServiceWorkers during initialiseConfig', async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    const getRegistrations = vi.fn().mockResolvedValue([
      {
        scope: window.location.origin + '/',
        active: { scriptURL: window.location.origin + '/sw.js' },
        unregister
      }
    ])

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistrations },
      configurable: true,
      writable: true
    })

    const testConfig = {
      oms: 'https://test.hotwax.io',
      current: { name: 'test' }
    }

    initialiseConfig(testConfig as any)

    expect(accxuiConfig.value.oms).toBe('https://test.hotwax.io')
    expect(getRegistrations).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(unregister).toHaveBeenCalledTimes(1)
    })
  })

  it('survives environments where serviceWorker is not supported or throws', async () => {
    // @ts-expect-error test unsupported
    delete navigator.serviceWorker

    expect(() => unregisterLegacyServiceWorkers()).not.toThrow()

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: vi.fn().mockRejectedValue(new Error('Permission denied'))
      },
      configurable: true,
      writable: true
    })

    expect(() => unregisterLegacyServiceWorkers()).not.toThrow()
  })
})
