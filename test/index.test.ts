import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createContractClient,
  ContractMetadataNotFoundError,
  ContractNotVerifiedOnSourcifyError,
} from '../src/index'
import {
  encodeFacets,
  encodeBool,
  rpcEnvelope,
  getCalldata,
  getCallTo,
} from './helpers/abi'
import { createMockFetch } from './helpers/mock-fetch'

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const DIAMOND = '0x1111111111111111111111111111111111111111'
const FACET_A = '0x' + 'aa'.repeat(20)
const FACET_B = '0x' + 'bb'.repeat(20)

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
        match: (url, body) => url.includes('rpc.test') && body.includes('"method":"eth_call"'),
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

  it('throws generic NotFoundError when Sourcify is disabled and no sources return metadata', async () => {
    const fetchFn = createMockFetch([]) // all 404

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
      sources: { sourcify: false },
    })

    let error: unknown
    try {
      await client.get(WETH)
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(ContractMetadataNotFoundError)
    expect(error).not.toBeInstanceOf(ContractNotVerifiedOnSourcifyError)
    expect((error as ContractMetadataNotFoundError).source).toBeUndefined()
    expect((error as ContractMetadataNotFoundError).reason).toBe('empty-response')
  })

  it('throws a specific error when Sourcify confirms no verification', async () => {
    const fetchFn = createMockFetch([])

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
    })

    let error: unknown
    try {
      await client.get(WETH)
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(ContractNotVerifiedOnSourcifyError)
    expect((error as ContractNotVerifiedOnSourcifyError).source).toBe('sourcify')
    expect((error as ContractNotVerifiedOnSourcifyError).reason).toBe('not-verified')
  })

  it('keeps generic not-found when Sourcify lookup fails', async () => {
    const fetchFn = createMockFetch([
      {
        match: url => url.includes('sourcify'),
        response: { status: 500, body: null },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      fetch: fetchFn,
    })

    let error: unknown
    try {
      await client.get(WETH)
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(ContractMetadataNotFoundError)
    expect(error).not.toBeInstanceOf(ContractNotVerifiedOnSourcifyError)
    expect((error as ContractMetadataNotFoundError).source).toBe('sourcify')
    expect((error as ContractMetadataNotFoundError).reason).toBe('source-unavailable')
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
      sources: { sourcify: false },
      // no rpc
    })

    // Should not throw about missing rpc, just skip contractURI
    let error: unknown
    try {
      await client.get(WETH)
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(ContractMetadataNotFoundError)
    expect(error).not.toBeInstanceOf(ContractNotVerifiedOnSourcifyError)
    expect((error as ContractMetadataNotFoundError).source).toBeUndefined()
    expect((error as ContractMetadataNotFoundError).reason).toBe('empty-response')
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

  it('requires a mainnet RPC for ENS resolution on mainnet', async () => {
    const client = createContractClient({
      chainId: 1,
      fetch: vi.fn() as unknown as typeof fetch,
      // no rpc, no ensRpc
    })

    await expect(client.get('vitalik.eth')).rejects.toThrow('ENS resolution requires a mainnet RPC')
  })

  it('requires ensRpc for ENS resolution on non-mainnet chains', async () => {
    // Even with an rpc configured, ENS must not piggyback on a non-mainnet RPC
    // (Universal Resolver only exists on mainnet).
    const client = createContractClient({
      chainId: 42161,
      rpc: 'https://arb.rpc.test',
      fetch: vi.fn() as unknown as typeof fetch,
      // no ensRpc
    })

    await expect(client.get('vitalik.eth')).rejects.toThrow('ENS resolution requires a mainnet RPC')
  })

  it('routes ENS resolution through ensRpc, not rpc, on non-mainnet chains', async () => {
    // We only need the mock to get as far as resolveEns on the ensRpc. The
    // ENS response itself doesn't need to be correct — we're asserting routing.
    const fetchFn = createMockFetch([
      {
        // Valid resolve() response: ABI-encoded bytes containing an address.
        match: (url, body) => url === 'https://mainnet.rpc.test' && body.includes('"method":"eth_call"'),
        response: {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: 1,
            // offset(0x20) + length(0x20) + addr(20 bytes padded to 32)
            result: '0x'
              + '0000000000000000000000000000000000000000000000000000000000000020'
              + '0000000000000000000000000000000000000000000000000000000000000020'
              + '000000000000000000000000' + 'c0'.repeat(20),
          },
        },
      },
      {
        // Sourcify 404 so get() can short-circuit without further RPC work.
        match: url => url.includes('sourcify'),
        response: { status: 404, body: null },
      },
      {
        match: url => url.includes('contract-metadata'),
        response: { status: 404, body: null },
      },
    ], '0xa4b1') // arbitrum chainId for the non-mainnet rpc

    const client = createContractClient({
      chainId: 42161,
      rpc: 'https://arb.rpc.test',
      ensRpc: 'https://mainnet.rpc.test',
      fetch: fetchFn,
    })

    // The resolved address won't have metadata; we only care that resolution
    // happened against ensRpc.
    await client.get('vitalik.eth').catch(() => null)

    const calls = (fetchFn as any).mock.calls
    const mainnetCalls = calls.filter((c: any[]) => c[0] === 'https://mainnet.rpc.test')
    const arbEnsCalls = calls.filter((c: any[]) => {
      if (c[0] !== 'https://arb.rpc.test') return false
      // Any eth_call targeting the Universal Resolver would be ENS leaking onto arb
      const body = typeof c[1]?.body === 'string' ? c[1].body : ''
      return body.toLowerCase().includes('0xce01f8eee7e479c928f8919abd53e553a36cef67')
    })

    expect(mainnetCalls.length).toBeGreaterThan(0)
    expect(arbEnsCalls.length).toBe(0)
  })

  it('throws when rpc eth_chainId disagrees with config.chainId', async () => {
    // Explicit eth_chainId mock that returns Base (8453) instead of mainnet.
    const fetchFn = createMockFetch([
      {
        match: (url, body) => url.includes('rpc.test') && body.includes('"method":"eth_chainId"'),
        response: { status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x2105' } }, // 8453
      },
      {
        match: url => url.includes('sourcify'),
        response: { status: 404, body: null },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: fetchFn,
    })

    // fetchContractURI surfaces the mismatch directly. (Inside get(), the
    // contractURI and diamond paths swallow it into null via their .catch
    // handlers, which would surface as a generic NotFound instead.)
    await expect(client.fetchContractURI(WETH)).rejects.toThrow('RPC chainId mismatch')
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

  // ── Proxy support (ERC-2535 diamond + EIP-1967 et al.) ────────────────

  describe('proxy', () => {
    it('detects diamond via ERC-165 and returns composite ABI + targets', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0xa9059cbb', '0x70a08231'] }, // transfer, balanceOf
        { address: FACET_B, selectors: ['0x18160ddd'] },               // totalSupply
      ])
      const facetSources = {
        [`facets/${FACET_A}/contracts/FacetA.sol`]: 'contract FacetA {}',
        [`facets/${FACET_B}/contracts/FacetB.sol`]: 'contract FacetB {}',
      }

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
              sources: {
                'contracts/FacetA.sol': { content: 'contract FacetA {}' },
              },
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
              sources: {
                'contracts/FacetB.sol': { content: 'contract FacetB {}' },
              },
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

      const result = await client.get(DIAMOND, { include: { sources: true } })
      expect(result.proxy?.pattern).toBe('eip-2535-diamond')
      expect(result.proxy?.targets).toHaveLength(2)
      expect(result.proxy?.targets[0].address).toBe(FACET_A)
      expect(result.proxy?.targets[0].selectors).toEqual(['0xa9059cbb', '0x70a08231'])
      expect(result.proxy?.targets[1].address).toBe(FACET_B)
      expect(result.proxy?.targets[1].selectors).toEqual(['0x18160ddd'])

      // Composite ABI has all three functions
      const fnNames = (result.abi as any[]).filter(f => f.type === 'function').map(f => f.name).sort()
      expect(fnNames).toEqual(['balanceOf', 'totalSupply', 'transfer'])

      // NatSpec merged across facets → metadata.functions populated for both
      expect(result.metadata.functions?.['transfer']).toBeTruthy()
      expect(result.metadata.functions?.['totalSupply']).toBeTruthy()

      // Source files are namespaced by facet address
      expect(result.sources).toEqual(facetSources)
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
      expect(result.proxy?.targets).toHaveLength(1)
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
      expect(result.proxy).toBeUndefined()

      // No facets() call should have been made
      const calls = (fetchFn as any).mock.calls
      const facetsProbe = calls.find((c: any[]) => {
        const body = typeof c[1]?.body === 'string' ? c[1].body : ''
        return getCalldata(body).startsWith('0x7a0ed627')
      })
      expect(facetsProbe).toBeUndefined()
    })

    it('returns non-proxy result when all probes fail', async () => {
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
          match: (url, body) => url.includes('rpc.test') && body.includes('"method":"eth_call"'),
          response: { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'revert' } } },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(WETH)
      expect(result.proxy).toBeUndefined()
      expect(result.abi).toEqual([{ type: 'function', name: 'foo', inputs: [] }])
    })

    it('lists target even when its Sourcify returns 404 (abi undefined)', async () => {
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
      expect(result.proxy?.targets).toHaveLength(1)
      expect(result.proxy?.targets[0].selectors).toEqual(['0x11111111', '0x22222222'])
      expect(result.proxy?.targets[0].abi).toBeUndefined()
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
      expect(result.proxy?.targets).toHaveLength(1)
      expect(result.proxy?.targets[0].address).toBe(FACET_A)
    })

    it('makes no on-chain probe calls when sources.proxy is false', async () => {
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
        sources: { proxy: false, contractURI: false },
      })

      await client.get(WETH)

      const calls = (fetchFn as any).mock.calls
      const rpcCall = calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('rpc.test'))
      expect(rpcCall).toBeUndefined()
    })

    it('does not recurse when a target address itself appears to be a proxy', async () => {
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

    it('does not fetch facet Sourcify when sources.sourcify is false', async () => {
      // Main goal: a diamond client configured without Sourcify should still
      // return facets + selectors, but MUST NOT hit Sourcify for any facet.
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x18160ddd'] },
        { address: FACET_B, selectors: ['0xa9059cbb'] },
      ])

      const fetchFn = createMockFetch([
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
        sources: { sourcify: false, contractURI: false },
      })

      const result = await client.get(DIAMOND)

      // Targets still populated with addresses + selectors
      expect(result.proxy?.targets).toHaveLength(2)
      expect(result.proxy?.targets[0].abi).toBeUndefined()
      expect(result.proxy?.targets[1].abi).toBeUndefined()

      // No Sourcify calls whatsoever
      const calls = (fetchFn as any).mock.calls.map((c: any) => c[0])
      expect(calls.some((url: string) => url.includes('sourcify'))).toBe(false)
    })

    it('resolves an EIP-1967 proxy: repo metadata on proxy, ABI from implementation', async () => {
      const PROXY = '0x2222222222222222222222222222222222222222'
      const IMPL = '0x' + 'cc'.repeat(20)

      const fetchFn = createMockFetch([
        // Repository file authored against the PROXY address
        {
          match: url => url.includes('contract-metadata') && url.includes(PROXY),
          response: {
            status: 200,
            body: {
              chainId: 1,
              address: PROXY,
              name: 'My Upgradeable Token',
              description: 'curated description',
            },
          },
        },
        // Sourcify on the proxy: not verified
        {
          match: url => url.includes('sourcify') && url.includes(PROXY),
          response: { status: 404, body: null },
        },
        // Sourcify on the implementation: verified with ABI + NatSpec
        {
          match: url => url.includes('sourcify') && url.includes(IMPL),
          response: {
            status: 200,
            body: {
              abi: [
                { type: 'function', name: 'totalSupply', inputs: [] },
                { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
              ],
              userdoc: { methods: { 'transfer(address,uint256)': { notice: 'move tokens' } } },
              devdoc: { methods: {} },
            },
          },
        },
        // Diamond probe returns false
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(false)) },
        },
        // EIP-1967 impl slot is set
        {
          match: (url, body) =>
            url.includes('rpc.test')
            && body.includes('"method":"eth_getStorageAt"')
            && body.toLowerCase().includes('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'),
          response: { status: 200, body: rpcEnvelope('0x' + IMPL.replace(/^0x/, '').padStart(64, '0')) },
        },
        // EIP-1967 admin slot is empty
        {
          match: (url, body) =>
            url.includes('rpc.test')
            && body.includes('"method":"eth_getStorageAt"')
            && body.toLowerCase().includes('0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'),
          response: { status: 200, body: rpcEnvelope('0x' + '00'.repeat(32)) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
      })

      const result = await client.get(PROXY)

      // Proxy info surfaces
      expect(result.proxy?.pattern).toBe('eip-1967')
      expect(result.proxy?.targets).toHaveLength(1)
      expect(result.proxy?.targets[0].address).toBe(IMPL)
      expect(result.proxy?.targets[0].selectors).toBeUndefined()

      // Curated repo name wins at the metadata level
      expect(result.metadata.name).toBe('My Upgradeable Token')

      // ABI comes from the implementation
      const fnNames = (result.abi as any[]).filter(f => f.type === 'function').map(f => f.name).sort()
      expect(fnNames).toEqual(['totalSupply', 'transfer'])

      // NatSpec comes from the implementation
      expect(result.natspec?.userdoc).toBeTruthy()
    })

    it('includes implementation source files for proxies when requested', async () => {
      const PROXY = '0x2222222222222222222222222222222222222222'
      const IMPL = '0x' + 'cc'.repeat(20)
      const implSources = {
        'contracts/Implementation.sol': 'contract Implementation {}',
        'contracts/Library.sol': 'library Library {}',
      }

      const fetchFn = createMockFetch([
        // Main proxy Sourcify: not verified
        {
          match: url => url.includes('sourcify') && url.includes(PROXY),
          response: { status: 404, body: null },
        },
        // Sourcify on the implementation: verified with ABI + source files
        {
          match: url => url.includes('sourcify') && url.includes(IMPL),
          response: {
            status: 200,
            body: {
              abi: [{ type: 'function', name: 'implementationFn', inputs: [] }],
              userdoc: { methods: {} },
              devdoc: { methods: {} },
              sources: Object.fromEntries(
                Object.entries(implSources).map(([path, content]) => [
                  path,
                  { content },
                ]),
              ),
            },
          },
        },
        // Diamond probe returns false
        {
          match: (url, body) => url.includes('rpc.test')
            && getCalldata(body).startsWith('0x01ffc9a7'),
          response: { status: 200, body: rpcEnvelope(encodeBool(false)) },
        },
        // EIP-1967 impl slot is set
        {
          match: (url, body) =>
            url.includes('rpc.test')
            && body.includes('"method":"eth_getStorageAt"')
            && body.toLowerCase().includes('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'),
          response: { status: 200, body: rpcEnvelope('0x' + IMPL.replace(/^0x/, '').padStart(64, '0')) },
        },
        // EIP-1967 admin slot is empty
        {
          match: (url, body) =>
            url.includes('rpc.test')
            && body.includes('"method":"eth_getStorageAt"')
            && body.toLowerCase().includes('0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'),
          response: { status: 200, body: rpcEnvelope('0x' + '00'.repeat(32)) },
        },
      ])

      const client = createContractClient({
        chainId: 1,
        rpc: 'https://rpc.test',
        fetch: fetchFn,
        sources: { repository: false, contractURI: false },
      })

      const result = await client.get(PROXY, { include: { sources: true } })

      expect(result.sources).toEqual(implSources)
      expect(result.proxy?.targets[0].sources).toEqual(implSources)

      const implementationSourcifyCall = (fetchFn as any).mock.calls
        .map((call: any) => call[0])
        .find((url: string) => url.includes('sourcify') && url.includes(IMPL))
      expect(implementationSourcifyCall).toContain('sources')
    })
  })

  // ── client.fetchProxy ────────────────────────────────────────────────

  describe('client.fetchProxy', () => {
    it('returns ProxyResolution with targets + composite ABI + natspec (diamond)', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0xa9059cbb'] },  // transfer
        { address: FACET_B, selectors: ['0x18160ddd'] },  // totalSupply
      ])

      const fetchFn = createMockFetch([
        {
          match: url => url.includes(FACET_A),
          response: {
            status: 200,
            body: {
              abi: [
                { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
              ],
              userdoc: { methods: { 'transfer(address,uint256)': { notice: 'move tokens' } } },
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
              userdoc: { methods: { 'totalSupply()': { notice: 'total supply' } } },
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

      const proxy = await client.fetchProxy(DIAMOND)
      expect(proxy).not.toBeNull()
      expect(proxy!.pattern).toBe('eip-2535-diamond')
      expect(proxy!.targets).toHaveLength(2)
      expect(proxy!.targets[0].address).toBe(FACET_A)
      expect(proxy!.targets[0].abi).toBeTruthy()
      expect(proxy!.targets[1].address).toBe(FACET_B)

      // Composite ABI across targets
      const fnNames = (proxy!.compositeAbi as any[])
        .filter(f => f.type === 'function').map(f => f.name).sort()
      expect(fnNames).toEqual(['totalSupply', 'transfer'])

      // Target NatSpec merged
      expect(proxy!.natspec?.userdoc).toBeTruthy()
    })

    it('returns null for non-proxies', async () => {
      const fetchFn = createMockFetch([
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

      const proxy = await client.fetchProxy(WETH)
      expect(proxy).toBeNull()
    })

    it('skips per-target Sourcify when options.sourcify is false', async () => {
      const facetsReturn = encodeFacets([
        { address: FACET_A, selectors: ['0x18160ddd', '0xa9059cbb'] },
      ])

      const fetchFn = createMockFetch([
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

      const proxy = await client.fetchProxy(DIAMOND, { sourcify: false })
      expect(proxy).not.toBeNull()
      expect(proxy!.targets).toHaveLength(1)
      expect(proxy!.targets[0].selectors).toEqual(['0x18160ddd', '0xa9059cbb'])
      expect(proxy!.targets[0].abi).toBeUndefined()
      expect(proxy!.compositeAbi).toBeUndefined()
      expect(proxy!.natspec).toBeUndefined()

      const calls = (fetchFn as any).mock.calls.map((c: any) => c[0])
      expect(calls.some((url: string) => url.includes('sourcify'))).toBe(false)
    })

    it('returns null when no rpc configured', async () => {
      const fetchFn = createMockFetch([])

      const client = createContractClient({
        chainId: 1,
        fetch: fetchFn,
      })

      const proxy = await client.fetchProxy(DIAMOND)
      expect(proxy).toBeNull()

      // No RPC calls made
      expect((fetchFn as any).mock.calls).toHaveLength(0)
    })
  })
})
