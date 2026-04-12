import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContractClient, ContractMetadataNotFoundError } from '../src/index'

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

describe('createContractClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('resolves from all three sources', async () => {
    const repoMetadata = {
      name: 'Wrapped Ether',
      functions: {
        deposit: { title: 'Wrap ETH', description: 'curated' },
      },
    }

    const sourcifyResponse = {
      name: 'WETH9',
      abi: [{ type: 'function', name: 'deposit' }],
      deployedBytecode: '0x6060604052',
      sources: {
        'contracts/WETH9.sol': { content: 'pragma solidity ^0.4.18;' },
      },
      userdoc: {
        methods: {
          'withdraw(uint256)': { notice: 'Withdraw WETH to ETH' },
        },
      },
      devdoc: {
        methods: {
          'withdraw(uint256)': { details: 'Burns WETH' },
        },
      },
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

    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: fetchFn,
    })

    const result = await client.get(WETH)

    // Top-level identity
    expect(result.chainId).toBe(1)
    expect(result.address).toBe(WETH)

    // Metadata: repository wins for name (highest priority)
    expect(result.metadata.name).toBe('Wrapped Ether')
    // contractURI provides symbol and image
    expect(result.metadata.symbol).toBe('WETH')
    expect(result.metadata.image).toBe('https://example.com/weth.png')
    // Repository's curated function takes priority
    expect(result.metadata.functions?.deposit).toEqual({ title: 'Wrap ETH', description: 'curated' })
    // Sourcify/NatSpec fills in functions not in repo
    expect(result.metadata.functions?.withdraw).toBeTruthy()
    expect(result.metadata.functions?.withdraw?.description).toBe('Withdraw WETH to ETH')

    // ABI from Sourcify
    expect(result.abi).toEqual([{ type: 'function', name: 'deposit' }])

    // NatSpec raw objects
    expect(result.natspec?.userdoc).toBeTruthy()
    expect(result.natspec?.devdoc).toBeTruthy()

    // Source code
    expect(result.sources).toEqual({ 'contracts/WETH9.sol': 'pragma solidity ^0.4.18;' })

    // Deployed bytecode
    expect(result.deployedBytecode).toBe('0x6060604052')
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

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
    })

    const result = await client.get(WETH)
    expect(result.metadata.name).toBe('WETH9')
    expect(result.chainId).toBe(1)
    expect(result.address).toBe(WETH)
    expect(result.abi).toEqual([{ type: 'function', name: 'deposit' }])
  })

  it('throws NotFoundError when all sources return null', async () => {
    const fetchFn = createMockFetch([]) // all 404

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
    })

    await expect(client.get(WETH)).rejects.toBeInstanceOf(ContractMetadataNotFoundError)
  })

  it('allows disabling sources via config', async () => {
    const repoMetadata = { name: 'From Repo' }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 200, body: repoMetadata },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
      sources: { sourcify: false, contractURI: false },
    })

    const result = await client.get(WETH)
    expect(result.metadata.name).toBe('From Repo')

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

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
    })

    // Disable repository for this call
    const result = await client.get(WETH, { sources: { repository: false } })
    expect(result.metadata.name).toBe('From Sourcify')
  })

  it('skips contractURI when no rpc configured', async () => {
    const fetchFn = createMockFetch([])

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
      // no rpc
    })

    // Should not throw about missing rpc, just skip contractURI
    await expect(client.get(WETH)).rejects.toBeInstanceOf(ContractMetadataNotFoundError)
  })

  it('exposes individual source fetchers', async () => {
    const repoMetadata = { name: 'WETH' }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 200, body: repoMetadata },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
    })

    const repo = await client.fetchRepository(WETH)
    expect(repo).toEqual(repoMetadata)

    const uri = await client.fetchContractURI(WETH)
    expect(uri).toBeNull() // no rpc configured

    const src = await client.fetchSourcify(WETH)
    expect(src).toBeNull() // 404
  })

  it('throws on invalid address or ENS name', async () => {
    const client = createContractClient({
      chainId: 1,
      fetch: vi.fn() as unknown as typeof fetch,
    })

    await expect(client.get('not-an-address')).rejects.toThrow('Invalid address or ENS name')
  })

  it('requires rpc for ENS resolution', async () => {
    const client = createContractClient({
      chainId: 1,
      fetch: vi.fn() as unknown as typeof fetch,
      // no rpc
    })

    await expect(client.get('vitalik.eth')).rejects.toThrow('RPC URL required')
  })

  it('omits natspec/sources/bytecode when sourcify has none', async () => {
    const repoMetadata = { name: 'Simple Contract' }

    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 200, body: repoMetadata },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
      sources: { sourcify: false, contractURI: false },
    })

    const result = await client.get(WETH)
    expect(result.abi).toBeUndefined()
    expect(result.natspec).toBeUndefined()
    expect(result.sources).toBeUndefined()
    expect(result.deployedBytecode).toBeUndefined()
  })
})
