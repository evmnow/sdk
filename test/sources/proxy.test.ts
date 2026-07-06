import { describe, it, expect, vi } from 'vitest'
import {
  composeProxyResolution,
  enrichTargets,
  fetchProxy,
} from '../../src/sources/proxy'
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_IMPL_SLOT,
} from '@1001-digital/proxies'
import type { ResolvedTarget } from '@1001-digital/proxies'
import type { SourcifyResult } from '../../src/types'
import {
  encodeAddress,
  encodeBool,
  encodeFacets,
  getCalldata,
  getMethod,
  getStorageSlot,
  rpcEnvelope,
} from '../helpers/abi'
import { createMockFetch } from '../helpers/mock-fetch'

// Primitive behavior (detection, ABI utilities, NatSpec merge) is covered by
// `@1001-digital/proxies`. These tests only exercise the SDK-specific adapter
// layer: Sourcify-bound enrichment and the metadata-layer composition that
// builds a Partial<ContractMetadataDocument>.

describe('enrichTargets (Sourcify-bound)', () => {
  const diamondTargets: ResolvedTarget[] = [
    { address: '0x' + 'aa'.repeat(20), selectors: ['0xa9059cbb'] },
    { address: '0x' + 'bb'.repeat(20), selectors: ['0x18160ddd'] },
  ]

  const singleImplTarget: ResolvedTarget = { address: '0x' + 'cc'.repeat(20) }

  it('returns address-only TargetInfo when sourcifyFetch is null', async () => {
    const { targets, sourcifyResults } = await enrichTargets(diamondTargets, null)
    expect(targets).toHaveLength(2)
    expect(targets[0].abi).toBeUndefined()
    expect(targets[0].natspec).toBeUndefined()
    expect(sourcifyResults).toEqual([null, null])
  })

  it('carries SourcifyResult through to sourcifyResults (diamond facets)', async () => {
    const src: SourcifyResult = {
      abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] }],
      userdoc: { methods: { 'transfer(address,uint256)': { notice: 'moves' } } },
      actions: { 'transfer(address,uint256)': { function: 'transfer(address,uint256)', description: 'moves' } },
    }
    const sourcifyFetch = vi.fn(async (addr: string) =>
      addr === '0x' + 'aa'.repeat(20) ? src : null,
    )

    const { targets, sourcifyResults } = await enrichTargets(diamondTargets, sourcifyFetch)
    expect(sourcifyFetch).toHaveBeenCalledTimes(2)
    expect(targets[0].abi).toHaveLength(1)
    expect(targets[0].natspec?.userdoc).toBeTruthy()
    // Facet results are selector-filtered copies (everything here is mounted)
    expect(sourcifyResults[0]).toEqual(src)
    expect(sourcifyResults[1]).toBeNull()
  })

  it('filters facet actions and natspec methods to mounted selectors', async () => {
    // The facet declares transfer + approve, but the diamond only mounts
    // transfer (0xa9059cbb). approve must not leak into actions or natspec.
    const src: SourcifyResult = {
      abi: [
        { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
        { type: 'function', name: 'approve', inputs: [{ type: 'address' }, { type: 'uint256' }] },
        { type: 'event', name: 'Transfer', inputs: [] },
      ],
      userdoc: {
        methods: {
          'transfer(address,uint256)': { notice: 'moves' },
          'approve(address,uint256)': { notice: 'approves' },
        },
      },
      devdoc: {
        methods: {
          'approve(address,uint256)': { details: 'internal' },
        },
      },
      actions: {
        transfer: { function: 'transfer', description: 'moves' },
        approve: { function: 'approve', description: 'approves' },
      },
    }
    const sourcifyFetch = vi.fn(async () => src)

    const { targets, sourcifyResults } = await enrichTargets(
      [{ address: '0x' + 'aa'.repeat(20), selectors: ['0xa9059cbb'] }],
      sourcifyFetch,
    )

    const filtered = sourcifyResults[0]!
    expect(Object.keys(filtered.actions!)).toEqual(['transfer'])
    expect(Object.keys((filtered.userdoc as any).methods)).toEqual(['transfer(address,uint256)'])
    expect(Object.keys((filtered.devdoc as any).methods)).toEqual([])
    // Target natspec is the filtered doc too
    expect(Object.keys((targets[0].natspec!.userdoc as any).methods))
      .toEqual(['transfer(address,uint256)'])

    // The composed metadata layer can no longer inject the unmounted action
    const out = composeProxyResolution(targets, sourcifyResults)
    expect(Object.keys(out.metadataLayer!.actions!)).toEqual(['transfer'])
  })

  it('filters signature-form action refs by mounted selector', async () => {
    const src: SourcifyResult = {
      actions: {
        'transfer(address,uint256)': { function: 'transfer(address,uint256)' },
        'approve(address,uint256)': { function: 'approve(address,uint256)' },
      },
    }
    const sourcifyFetch = vi.fn(async () => src)

    const { sourcifyResults } = await enrichTargets(
      [{ address: '0x' + 'aa'.repeat(20), selectors: ['0xa9059cbb'] }],
      sourcifyFetch,
    )

    expect(Object.keys(sourcifyResults[0]!.actions!)).toEqual(['transfer(address,uint256)'])
  })

  it('does not filter single-impl targets (no selectors)', async () => {
    const src: SourcifyResult = {
      abi: [{ type: 'function', name: 'anything', inputs: [] }],
      actions: { anything: { function: 'anything' } },
    }
    const sourcifyFetch = vi.fn(async () => src)

    const { sourcifyResults } = await enrichTargets([singleImplTarget], sourcifyFetch)
    expect(sourcifyResults[0]).toBe(src)
  })

  it('passes full ABI through for single-impl targets (no selector filter)', async () => {
    const src: SourcifyResult = {
      abi: [
        { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
        { type: 'function', name: 'approve', inputs: [{ type: 'address' }, { type: 'uint256' }] },
      ],
    }
    const sourcifyFetch = vi.fn(async () => src)
    const { targets } = await enrichTargets([singleImplTarget], sourcifyFetch)
    expect(targets[0].selectors).toBeUndefined()
    expect(targets[0].abi).toHaveLength(2)
  })

  it('attaches verified source files to enriched targets', async () => {
    const src: SourcifyResult = {
      abi: [{ type: 'function', name: 'implementationFn', inputs: [] }],
      sources: {
        'contracts/Implementation.sol': 'contract Implementation {}',
      },
    }
    const sourcifyFetch = vi.fn(async () => src)

    const { targets } = await enrichTargets([singleImplTarget], sourcifyFetch)

    expect(targets[0].sources).toEqual(src.sources)
  })

  it('swallows per-target sourcify errors', async () => {
    const sourcifyFetch = vi.fn(async () => { throw new Error('boom') })
    const { targets, sourcifyResults } = await enrichTargets(diamondTargets, sourcifyFetch)
    expect(targets).toHaveLength(2)
    expect(sourcifyResults).toEqual([null, null])
  })
})

describe('composeProxyResolution (metadataLayer)', () => {
  it('builds metadataLayer from SourcifyResult.actions/events/errors', () => {
    const targets = [
      {
        address: '0x' + 'aa'.repeat(20),
        selectors: ['0xa9059cbb'],
        abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] }],
      },
    ]
    const sourcifyResults: SourcifyResult[] = [
      {
        actions: { 'transfer(address,uint256)': { function: 'transfer(address,uint256)', description: 'moves tokens' } },
        events: { 'Transfer(address,address,uint256)': { description: 'emitted on transfer' } },
      },
    ]

    const out = composeProxyResolution(targets, sourcifyResults)
    expect(out.metadataLayer?.actions).toBeTruthy()
    expect(out.metadataLayer?.events).toBeTruthy()
    expect(out.compositeAbi).toHaveLength(1)
  })

  it('omits metadataLayer when no Sourcify layer yields content', () => {
    const targets = [{ address: '0x' + 'aa'.repeat(20), selectors: ['0x18160ddd'] }]
    const out = composeProxyResolution(targets, [null])
    expect(out.metadataLayer).toBeUndefined()
    expect(out.compositeAbi).toBeUndefined()
    expect(out.natspec).toBeUndefined()
  })

  it('metadataLayer is first-target-wins, consistent with the natspec merge', () => {
    const targets = [
      {
        address: '0x' + 'aa'.repeat(20),
        natspec: { userdoc: { methods: { 'f()': { notice: 'from A' } } } },
      },
      {
        address: '0x' + 'bb'.repeat(20),
        natspec: { userdoc: { methods: { 'f()': { notice: 'from B' } } } },
      },
    ]
    const sourcifyResults: SourcifyResult[] = [
      { actions: { f: { function: 'f', description: 'from A' } } },
      { actions: { f: { function: 'f', description: 'from B' } } },
    ]

    const out = composeProxyResolution(targets, sourcifyResults)
    expect(out.metadataLayer?.actions?.f?.description).toBe('from A')
    expect((out.natspec?.userdoc as any).methods['f()'].notice).toBe('from A')
  })
})

describe('fetchProxy (high-level)', () => {
  const PROXY_ADDR = '0x1111111111111111111111111111111111111111'
  const FACET_ADDR = '0x' + 'aa'.repeat(20)
  const IMPL_ADDR = '0x' + 'cc'.repeat(20)

  it('returns null when the contract is not a proxy', async () => {
    const fetchFn = createMockFetch([
      {
        match: (url, body) => url.includes('rpc.test')
          && getCalldata(body).startsWith('0x01ffc9a7'),
        response: { status: 200, body: rpcEnvelope(encodeBool(false)) },
      },
      {
        match: (url, body) => url.includes('rpc.test') && getMethod(body) === 'eth_getStorageAt',
        response: { status: 200, body: rpcEnvelope(encodeAddress('0x' + '00'.repeat(20))) },
      },
      {
        match: (url, body) => url.includes('rpc.test') && getMethod(body) === 'eth_getCode',
        response: { status: 200, body: rpcEnvelope('0x') },
      },
    ])
    const result = await fetchProxy('https://rpc.test', 1, PROXY_ADDR, fetchFn)
    expect(result).toBeNull()
  })

  it('resolves a diamond with metadataLayer when Sourcify enrichment succeeds', async () => {
    const facetsReturn = encodeFacets([{ address: FACET_ADDR, selectors: ['0x18160ddd'] }])
    const fetchFn = createMockFetch([
      {
        match: url => url.includes(FACET_ADDR) && url.includes('sourcify'),
        response: {
          status: 200,
          body: {
            abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
            userdoc: { methods: { 'totalSupply()': { notice: 'supply' } } },
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

    const result = await fetchProxy(
      'https://rpc.test', 1, PROXY_ADDR, fetchFn,
      { sourcifyUrl: 'https://sourcify.test' },
    )
    expect(result).not.toBeNull()
    expect(result!.pattern).toBe('eip-2535-diamond')
    expect(result!.targets).toHaveLength(1)
    expect(result!.targets[0].abi).toHaveLength(1)
    expect(result!.compositeAbi).toHaveLength(1)
    expect(result!.metadataLayer?.actions).toBeTruthy()
    expect(result!.natspec?.userdoc).toBeTruthy()
  })

  it('resolves an EIP-1967 proxy and pulls ABI from the implementation', async () => {
    const fetchFn = createMockFetch([
      {
        match: url => url.includes(IMPL_ADDR) && url.includes('sourcify'),
        response: {
          status: 200,
          body: {
            abi: [{ type: 'function', name: 'totalSupply', inputs: [] }],
            userdoc: { methods: { 'totalSupply()': { notice: 'supply' } } },
          },
        },
      },
      // Diamond probe — return false cleanly
      {
        match: (url, body) => url.includes('rpc.test')
          && getCalldata(body).startsWith('0x01ffc9a7'),
        response: { status: 200, body: rpcEnvelope(encodeBool(false)) },
      },
      {
        match: (url, body) => url.includes('rpc.test')
          && getMethod(body) === 'eth_getStorageAt'
          && getStorageSlot(body) === EIP1967_IMPL_SLOT,
        response: { status: 200, body: rpcEnvelope(encodeAddress(IMPL_ADDR)) },
      },
      {
        match: (url, body) => url.includes('rpc.test')
          && getMethod(body) === 'eth_getStorageAt'
          && getStorageSlot(body) === EIP1967_ADMIN_SLOT,
        response: { status: 200, body: rpcEnvelope(encodeAddress('0x' + '00'.repeat(20))) },
      },
    ])

    const result = await fetchProxy(
      'https://rpc.test', 1, PROXY_ADDR, fetchFn,
      { sourcifyUrl: 'https://sourcify.test' },
    )
    expect(result).not.toBeNull()
    expect(result!.pattern).toBe('eip-1967')
    expect(result!.targets).toHaveLength(1)
    expect(result!.targets[0].address).toBe(IMPL_ADDR)
    expect(result!.targets[0].selectors).toBeUndefined()
    expect(result!.targets[0].abi).toHaveLength(1)
    expect(result!.compositeAbi).toHaveLength(1)
    expect(result!.natspec?.userdoc).toBeTruthy()
  })

  it('sourcify: false returns address+selectors only, no Sourcify traffic', async () => {
    const facetsReturn = encodeFacets([{ address: FACET_ADDR, selectors: ['0x18160ddd'] }])
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

    const result = await fetchProxy(
      'https://rpc.test', 1, PROXY_ADDR, fetchFn, { sourcify: false },
    )
    expect(result).not.toBeNull()
    expect(result!.targets[0].abi).toBeUndefined()
    expect(result!.metadataLayer).toBeUndefined()

    const calls = (fetchFn as any).mock.calls.map((c: any) => c[0])
    expect(calls.some((url: string) => url.includes('sourcify'))).toBe(false)
  })
})
