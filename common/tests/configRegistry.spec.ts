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

  it('unregisters all service workers when getRegistrations returns active workers', async () => {
    const unregister1 = vi.fn().mockResolvedValue(true)
    const unregister2 = vi.fn().mockResolvedValue(true)
    const fakeRegistrations = [
      { unregister: unregister1 },
      { unregister: unregister2 }
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

  it('runs unregisterLegacyServiceWorkers during initialiseConfig', async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }])

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
