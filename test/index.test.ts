import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContractClient, ContractMetadataNotFoundError } from '../src/index'
import {
  encodeFacets,
  encodeBool,
  rpcEnvelope,
  getCalldata,
  getCallTo,
} from './helpers/abi'

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const DIAMOND = '0x1111111111111111111111111111111111111111'
const FACET_A = '0x' + 'aa'.repeat(20)
const FACET_B = '0x' + 'bb'.repeat(20)

type MockRoute = {
  match: (url: string, body: string) => boolean
  response: { status: number; body: unknown }
}

function createMockFetch(routes: MockRoute[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = typeof init?.body === 'string' ? init.body : ''

    for (const route of routes) {
      if (route.match(url, body)) {
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

    const result = await client.get(WETH, {
      include: { sources: true, deployedBytecode: true },
    })

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

    // Source code (opt-in via include)
    expect(result.sources).toEqual({ 'contracts/WETH9.sol': 'pragma solidity ^0.4.18;' })

    // Deployed bytecode (opt-in via include)
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
    expect(result.metadata.name).toBeUndefined()
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
      abi: [{ type: 'function', name: 'deposit' }],
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
    expect(result.metadata.name).toBeUndefined()
    expect(result.abi).toEqual([{ type: 'function', name: 'deposit' }])
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

  it('does not request sources/bytecode from Sourcify by default', async () => {
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

    await client.get(WETH)

    const sourcifyCall = (fetchFn as any).mock.calls
      .map((c: any) => c[0])
      .find((url: string) => url.includes('sourcify'))
    expect(sourcifyCall).not.toContain('deployedBytecode')
    expect(sourcifyCall).not.toContain('sources')
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

  // ── Diamond (ERC-2535) support ────────────────────────────────────────

  describe('diamond (ERC-2535)', () => {
    it('detects via ERC-165 and returns composite ABI + facets', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0xa9059cbb', '0x70a08231'] }, // transfer, balanceOf
        { address: FACET_B, selectors: ['0x18160ddd'] },               // totalSupply
      ])

      const fetchFn = createMockFetch([
        // Main diamond Sourcify: not verified
        { match: url => url.includes(DIAMOND), response: { status: 404, body: null } },
        // Facet A ABI
        {
          match: url => url.includes(FACET_A),
          response: {
            status: 200,
            body: {
              abi: [
                { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
                { type: 'function', name: 'balanceOf', inputs: [{ type: 'address' }] },
              ],
              userdoc: { methods: { 'transfer(address,uint256)': { notice: 'move tokens' } } },
              devdoc: { methods: {} },
            },
          },
        },
        // Facet B ABI
        {
          match: url => url.includes(FACET_B),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
              userdoc: { methods: { 'totalSupply()': { notice: 'total supply' } } },
              devdoc: { methods: {} },
            },
          },
        },
        // RPC: ERC-165 supportsInterface → true
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(true)) },
        },
        // RPC: facets()
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x7a0ed627'),
          response: { status: 200, body: rpcEnvelope(facetsReturn) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(DIAMOND)
      expect(result.facets).toHaveLength(2)
      expect(result.facets?.[0].address).toBe(FACET_A)
      expect(result.facets?.[0].selectors).toEqual(['0xa9059cbb', '0x70a08231'])
      expect(result.facets?.[1].address).toBe(FACET_B)
      expect(result.facets?.[1].selectors).toEqual(['0x18160ddd'])

      // Composite ABI has all three functions
      const fnNames = (result.abi as any[]).filter(f => f.type === 'function').map(f => f.name).sort()
      expect(fnNames).toEqual(['balanceOf', 'totalSupply', 'transfer'])

      // NatSpec merged across facets → metadata.functions populated for both
      expect(result.metadata.functions?.['transfer']).toBeTruthy()
      expect(result.metadata.functions?.['totalSupply']).toBeTruthy()
    })

    it('falls back to facets() probe when ERC-165 errors', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x18160ddd'] },
      ])

      const fetchFn = createMockFetch([
        { match: url => url.includes(DIAMOND), response: { status: 404, body: null } },
        {
          match: url => url.includes(FACET_A),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        // ERC-165 reverts (JSON-RPC error)
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'revert' } } },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x7a0ed627'),
          response: { status: 200, body: rpcEnvelope(facetsReturn) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(DIAMOND)
      expect(result.facets).toHaveLength(1)
      expect((result.abi as any[])[0].name).toBe('totalSupply')
    })

    it('does not probe facets() when ERC-165 returns definitive false', async () => {
      const fetchFn = createMockFetch([
        {
          match: url => url.includes('sourcify'),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'foo', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(false)) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(WETH)
      expect(result.facets).toBeUndefined()

      // No facets() call should have been made
      const calls = (fetchFn as any).mock.calls
      const facetsProbe = calls.find((c: any[]) => {
        const body = typeof c[1]?.body === 'string' ? c[1].body : ''
        return getCalldata(body).startsWith('0x7a0ed627')
      })
      expect(facetsProbe).toBeUndefined()
    })

    it('returns non-diamond result when both probes fail', async () => {
      const fetchFn = createMockFetch([
        {
          match: url => url.includes('sourcify'),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'foo', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        // Both RPC calls fail with JSON-RPC errors
        {
          match: url => url.includes('rpc.test'),
          response: { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'revert' } } },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(WETH)
      expect(result.facets).toBeUndefined()
      expect(result.abi).toEqual([{ type: 'function', name: 'foo', inputs: [] }])
    })

    it('lists facet even when its Sourcify returns 404 (abi undefined)', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x11111111', '0x22222222'] },
      ])

      const fetchFn = createMockFetch([
        // Diamond + facet both 404 on Sourcify
        { match: url => url.includes('sourcify'), response: { status: 404, body: null } },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(true)) },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x7a0ed627'),
          response: { status: 200, body: rpcEnvelope(facetsReturn) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(DIAMOND)
      expect(result.facets).toHaveLength(1)
      expect(result.facets?.[0].selectors).toEqual(['0x11111111', '0x22222222'])
      expect(result.facets?.[0].abi).toBeUndefined()
      expect(result.abi).toBeUndefined() // no ABI from anywhere
    })

    it('skips zero-address facets', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x18160ddd'] },
        { address: '0x' + '00'.repeat(20), selectors: ['0xdeadbeef'] },
      ])

      const fetchFn = createMockFetch([
        {
          match: url => url.includes(FACET_A),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        { match: url => url.includes('sourcify'), response: { status: 404, body: null } },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(true)) },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x7a0ed627'),
          response: { status: 200, body: rpcEnvelope(facetsReturn) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(DIAMOND)
      expect(result.facets).toHaveLength(1)
      expect(result.facets?.[0].address).toBe(FACET_A)
    })

    it('makes no diamond probe calls when sources.diamond is false', async () => {
      const fetchFn = createMockFetch([
        {
          match: url => url.includes('sourcify'),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'foo', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
        sources: { diamond: false, contractURI: false },
      })

      await client.get(WETH)

      const calls = (fetchFn as any).mock.calls
      const rpcCall = calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('rpc.test'))
      expect(rpcCall).toBeUndefined()
    })

    it('does not recurse when a facet address itself appears to be a diamond', async () => {
      // Facet A's Sourcify returns, but if we accidentally re-triggered diamond
      // detection, we would see extra RPC calls to FACET_A as the "to" address.
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x18160ddd'] },
      ])

      const fetchFn = createMockFetch([
        { match: url => url.includes(DIAMOND), response: { status: 404, body: null } },
        {
          match: url => url.includes(FACET_A),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(true)) },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x7a0ed627'),
          response: { status: 200, body: rpcEnvelope(facetsReturn) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      await client.get(DIAMOND)

      // No RPC call should target FACET_A
      const calls = (fetchFn as any).mock.calls
      const facetRpcCall = calls.find((c: any[]) => {
        if (typeof c[0] !== 'string' || !c[0].includes('rpc.test')) return false
        const body = typeof c[1]?.body === 'string' ? c[1].body : ''
        return getCallTo(body) === FACET_A
      })
      expect(facetRpcCall).toBeUndefined()
    })

    it('dedups the same selector across two facets (first wins)', async () => {
      // Two facets both declare totalSupply(). Diamond spec technically forbids
      // this, but we still dedup defensively.
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x18160ddd'] },
        { address: FACET_B, selectors: ['0x18160ddd'] },
      ])

      const fetchFn = createMockFetch([
        { match: url => url.includes(DIAMOND), response: { status: 404, body: null } },
        {
          match: url => url.includes(FACET_A),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        {
          match: url => url.includes(FACET_B),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
            },
          },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(true)) },
        },
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x7a0ed627'),
          response: { status: 200, body: rpcEnvelope(facetsReturn) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(DIAMOND)
      const fns = (result.abi as any[]).filter(f => f.type === 'function')
      expect(fns).toHaveLength(1)
    })
  })
})
