import { describe, it, expect, vi } from 'vitest'
import {
  enrichFacets,
  composeDiamondResolution,
  fetchDiamond,
} from '../../src/sources/diamond'
import type { RawFacet } from '@1001-digital/diamonds'
import type { SourcifyResult } from '../../src/types'
import {
  encodeFacets,
  encodeBool,
  rpcEnvelope,
  getCalldata,
} from '../helpers/abi'
import { createMockFetch } from '../helpers/mock-fetch'

// Primitive behavior (decodeFacets, computeSelector, canonicalSignature,
// filterAbiBySelectors, buildCompositeAbi, mergeNatspecDocs, detectAndFetchFacets)
// is covered by `@1001-digital/diamonds`. These tests only exercise the
// SDK-specific adapter layer: Sourcify-bound enrichment and the metadata-layer
// composition that builds a Partial<ContractMetadataDocument>.

describe('enrichFacets (Sourcify-bound)', () => {
  const rawFacets: RawFacet[] = [
    { facetAddress: '0x' + 'aa'.repeat(20), functionSelectors: ['0xa9059cbb'] },   // transfer
    { facetAddress: '0x' + 'bb'.repeat(20), functionSelectors: ['0x18160ddd'] },   // totalSupply
  ]

  it('returns address-only FacetInfo when sourcifyFetch is null', async () => {
    const { facets, sourcifyResults } = await enrichFacets(rawFacets, null)
    expect(facets).toHaveLength(2)
    expect(facets[0].abi).toBeUndefined()
    expect(facets[0].natspec).toBeUndefined()
    expect(sourcifyResults).toEqual([null, null])
  })

  it('carries SourcifyResult through to sourcifyResults for downstream compose', async () => {
    const src: SourcifyResult = {
      abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] }],
      userdoc: { methods: { 'transfer(address,uint256)': { notice: 'moves' } } },
      functions: { 'transfer(address,uint256)': { description: 'moves' } },
    }
    const sourcifyFetch = vi.fn(async (addr: string) =>
      addr === '0x' + 'aa'.repeat(20) ? src : null,
    )

    const { facets, sourcifyResults } = await enrichFacets(rawFacets, sourcifyFetch)
    expect(sourcifyFetch).toHaveBeenCalledTimes(2)
    expect(facets[0].abi).toHaveLength(1)
    expect(facets[0].natspec?.userdoc).toBeTruthy()
    expect(sourcifyResults[0]).toBe(src)
    expect(sourcifyResults[1]).toBeNull()
  })

  it('swallows per-facet sourcify errors', async () => {
    const sourcifyFetch = vi.fn(async () => { throw new Error('boom') })
    const { facets, sourcifyResults } = await enrichFacets(rawFacets, sourcifyFetch)
    expect(facets).toHaveLength(2)
    expect(sourcifyResults).toEqual([null, null])
  })
})

describe('composeDiamondResolution (metadataLayer)', () => {
  it('builds metadataLayer from SourcifyResult.functions/events/errors', () => {
    const facets = [
      {
        address: '0x' + 'aa'.repeat(20),
        selectors: ['0xa9059cbb'],
        abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] }],
      },
    ]
    const sourcifyResults: SourcifyResult[] = [
      {
        functions: { 'transfer(address,uint256)': { description: 'moves tokens' } },
        events: { 'Transfer(address,address,uint256)': { description: 'emitted on transfer' } },
      },
    ]

    const out = composeDiamondResolution(facets, sourcifyResults)
    expect(out.metadataLayer?.functions).toBeTruthy()
    expect(out.metadataLayer?.events).toBeTruthy()
    expect(out.compositeAbi).toHaveLength(1)
  })

  it('omits metadataLayer when no Sourcify layer yields content', () => {
    const facets = [{ address: '0x' + 'aa'.repeat(20), selectors: ['0x18160ddd'] }]
    const out = composeDiamondResolution(facets, [null])
    expect(out.metadataLayer).toBeUndefined()
    expect(out.compositeAbi).toBeUndefined()
    expect(out.natspec).toBeUndefined()
  })
})

describe('fetchDiamond (high-level)', () => {
  const DIAMOND_ADDR = '0x1111111111111111111111111111111111111111'
  const FACET_ADDR = '0x' + 'aa'.repeat(20)

  it('returns null when the contract is not a diamond', async () => {
    const fetchFn = createMockFetch([
      {
        match: (url, body) => url.includes('rpc.test')
          && getCalldata(body).startsWith('0x01ffc9a7'),
        response: { status: 200, body: rpcEnvelope(encodeBool(false)) },
      },
    ])
    const result = await fetchDiamond('https://rpc.test', 1, DIAMOND_ADDR, fetchFn)
    expect(result).toBeNull()
  })

  it('returns a resolution with metadataLayer when Sourcify enrichment succeeds', async () => {
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

    const result = await fetchDiamond(
      'https://rpc.test', 1, DIAMOND_ADDR, fetchFn,
      { sourcifyUrl: 'https://sourcify.test' },
    )
    expect(result).not.toBeNull()
    expect(result!.facets).toHaveLength(1)
    expect(result!.facets[0].abi).toHaveLength(1)
    expect(result!.compositeAbi).toHaveLength(1)
    expect(result!.metadataLayer?.functions).toBeTruthy()
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

    const result = await fetchDiamond(
      'https://rpc.test', 1, DIAMOND_ADDR, fetchFn, { sourcify: false },
    )
    expect(result).not.toBeNull()
    expect(result!.facets[0].abi).toBeUndefined()
    expect(result!.metadataLayer).toBeUndefined()

    const calls = (fetchFn as any).mock.calls.map((c: any) => c[0])
    expect(calls.some((url: string) => url.includes('sourcify'))).toBe(false)
  })
})
