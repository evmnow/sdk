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
    expect(sourcifyResults[0]).toBe(src)
    expect(sourcifyResults[1]).toBeNull()
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
