import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContractMetadata, ContractMetadataNotFoundError } from '../src/index'

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

// Helpers to build mock fetch responses keyed by URL pattern
type MockRoute = {
  match: (url: string) => boolean
  response: { status: number; body: unknown }
}

function createMockFetch(routes: MockRoute[]) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    for (const route of routes) {
      if (route.match(url)) {
        return {
          ok: route.response.status >= 200 && route.response.status < 300,
          status: route.response.status,
          json: () => Promise.resolve(route.response.body),
          text: () => Promise.resolve(JSON.stringify(route.response.body)),
        }
      }
    }

    return { ok: false, status: 404, json: () => Promise.resolve(null) }
  }) as unknown as typeof fetch
}

describe('createContractMetadata', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('resolves metadata from all three sources', async () => {
    const repoMetadata = {
      name: 'Wrapped Ether',
      functions: {
        deposit: { title: 'Wrap ETH', description: 'curated' },
      },
    }

    const sourcifyResponse = {
      name: 'WETH9',
      abi: [{ type: 'function', name: 'deposit' }],
      userdoc: {
        methods: {
          'withdraw(uint256)': { notice: 'Withdraw WETH to ETH' },
        },
      },
      devdoc: { methods: {} },
    }

    const contractUriJson = {
      name: 'WETH from contract',
      symbol: 'WETH',
      image: 'https://example.com/weth.png',
    }
    const dataUri = `data:application/json;base64,${btoa(JSON.stringify(contractUriJson))}`

    // Encode contractURI return value
    const uriHex = Array.from(new TextEncoder().encode(dataUri))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    const padded = uriHex.padEnd(Math.ceil(uriHex.length / 64) * 64, '0')
    const abiResult = '0x'
      + '0000000000000000000000000000000000000000000000000000000000000020'
      + dataUri.length.toString(16).padStart(64, '0')
      + padded

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata') && url.includes(WETH),
        response: { status: 200, body: repoMetadata },
      },
      {
        match: url => url.includes('sourcify.dev'),
        response: { status: 200, body: sourcifyResponse },
      },
      {
        match: url => url.includes('rpc.test'),
        response: { status: 200, body: { jsonrpc: '2.0', id: 1, result: abiResult } },
      },
    ])

    const cm = createContractMetadata({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: fetchFn,
    })

    const result = await cm.get(WETH)

    // Repository wins for name (highest priority)
    expect(result.name).toBe('Wrapped Ether')
    // contractURI provides symbol and image
    expect(result.symbol).toBe('WETH')
    expect(result.image).toBe('https://example.com/weth.png')
    // Repository's curated function takes priority
    expect(result.functions?.deposit).toEqual({ title: 'Wrap ETH', description: 'curated' })
    // Sourcify/NatSpec fills in functions not in repo
    expect(result.functions?.withdraw).toBeTruthy()
    expect(result.functions?.withdraw?.description).toBe('Withdraw WETH to ETH')
    // Always has chainId and address
    expect(result.chainId).toBe(1)
    expect(result.address).toBe(WETH)
  })

  it('works with sourcify only', async () => {
    const sourcifyResponse = {
      name: 'WETH9',
      abi: [{ type: 'function', name: 'deposit' }],
      userdoc: { methods: {} },
      devdoc: { methods: {} },
    }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('sourcify'),
        response: { status: 200, body: sourcifyResponse },
      },
    ])

    const cm = createContractMetadata({
      chainId: 1,
      fetch: fetchFn,
    })

    const result = await cm.get(WETH)
    expect(result.name).toBe('WETH9')
    expect(result.chainId).toBe(1)
    expect(result.address).toBe(WETH)
  })

  it('throws NotFoundError when all sources return null', async () => {
    const fetchFn = createMockFetch([]) // all 404

    const cm = createContractMetadata({
      chainId: 1,
      fetch: fetchFn,
    })

    await expect(cm.get(WETH)).rejects.toBeInstanceOf(ContractMetadataNotFoundError)
  })

  it('allows disabling sources via config', async () => {
    const repoMetadata = { name: 'From Repo' }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 200, body: repoMetadata },
      },
    ])

    const cm = createContractMetadata({
      chainId: 1,
      fetch: fetchFn,
      sources: { sourcify: false, contractURI: false },
    })

    const result = await cm.get(WETH)
    expect(result.name).toBe('From Repo')

    // Sourcify should not have been called
    const calls = (fetchFn as any).mock.calls.map((c: any) => c[0])
    expect(calls.some((url: string) => url.includes('sourcify'))).toBe(false)
  })

  it('allows per-call source overrides', async () => {
    const repoMetadata = { name: 'From Repo' }
    const sourcifyResponse = {
      name: 'From Sourcify',
      userdoc: { methods: {} },
      devdoc: { methods: {} },
    }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 200, body: repoMetadata },
      },
      {
        match: url => url.includes('sourcify'),
        response: { status: 200, body: sourcifyResponse },
      },
    ])

    const cm = createContractMetadata({
      chainId: 1,
      fetch: fetchFn,
    })

    // Disable repository for this call
    const result = await cm.get(WETH, { sources: { repository: false } })
    expect(result.name).toBe('From Sourcify')
  })

  it('skips contractURI when no rpc configured', async () => {
    const fetchFn = createMockFetch([])

    const cm = createContractMetadata({
      chainId: 1,
      fetch: fetchFn,
      // no rpc
    })

    // Should not throw about missing rpc, just skip contractURI
    await expect(cm.get(WETH)).rejects.toBeInstanceOf(ContractMetadataNotFoundError)
  })

  it('exposes individual source fetchers', async () => {
    const repoMetadata = { name: 'WETH' }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 200, body: repoMetadata },
      },
    ])

    const cm = createContractMetadata({
      chainId: 1,
      fetch: fetchFn,
    })

    const repo = await cm.fetchRepository(WETH)
    expect(repo).toEqual(repoMetadata)

    const uri = await cm.fetchContractURI(WETH)
    expect(uri).toBeNull() // no rpc configured

    const src = await cm.fetchSourcify(WETH)
    expect(src).toBeNull() // 404
  })

  it('throws on invalid address or ENS name', async () => {
    const cm = createContractMetadata({
      chainId: 1,
      fetch: vi.fn() as unknown as typeof fetch,
    })

    await expect(cm.get('not-an-address')).rejects.toThrow('Invalid address or ENS name')
  })

  it('requires rpc for ENS resolution', async () => {
    const cm = createContractMetadata({
      chainId: 1,
      fetch: vi.fn() as unknown as typeof fetch,
      // no rpc
    })

    await expect(cm.get('vitalik.eth')).rejects.toThrow('RPC URL required')
  })
})
