import type { Page } from 'playwright'
import { PlaywrightBrowserProvider } from '@vitest/browser-playwright'
import { expect, test, vi } from 'vitest'

test.for(['chromium', 'firefox', 'webkit'])('[playwright] %s registers a mock only once interception is confirmed', async (browserName, { onTestFinished }) => {
  let routes: Array<{ predicate: (url: URL) => boolean; handler: (route: any) => unknown }> = []
  let attempts = 0
  let releaseProbe: () => void
  let probeIsPending!: () => void
  const pending = new Promise<void>(resolve => (probeIsPending = resolve))
  const fakeFetch = async (url: string) => {
    const route = ++attempts > 1 && routes.find(({ predicate }) => predicate(new URL(url, 'http://localhost')))
    if (!route) {
      throw new Error('not intercepted')
    }
    await new Promise<void>((resolve) => {
      releaseProbe = resolve
      probeIsPending()
    })
    let response: any
    await route.handler({ fulfill: (fulfilled: any) => (response = fulfilled) })
    return { headers: { get: (name: string) => response.headers[name] } }
  }
  const page = {
    context: () => ({
      route: async (predicate: (url: URL) => boolean, handler: (route: any) => unknown) => void routes.push({ predicate, handler }),
      unroute: async (predicate: (url: URL) => boolean) => void (routes = routes.filter(route => route.predicate !== predicate)),
    }),
    evaluate: (fn: (url: string) => unknown, url: string) => {
      vi.stubGlobal('fetch', fakeFetch)
      return Promise.resolve(fn(url)).finally(() => vi.unstubAllGlobals())
    },
  }
  const project = { config: { browser: { name: browserName } }, browser: { registerCommand: () => {} } }
  const provider = new PlaywrightBrowserProvider(project as any, {})
  onTestFinished(() => provider.close())
  provider.getPage = () => page as unknown as Page
  let registered = false
  const module = { type: 'redirect', url: '/src/mocked.ts', redirect: '/src/actual.ts' } as any
  const registering = provider.mocker!.register('session-1', module).then(() => (registered = true))
  if (browserName === 'chromium') {
    await pending
    expect(registered).toBe(false)
    releaseProbe!()
  }
  await registering
  expect(routes).toHaveLength(browserName === 'chromium' ? 2 : 1)
  await provider.mocker!.clear('session-1')
  expect(routes).toHaveLength(0)
})
