import { describe, it, expect, vi } from 'vitest'
import {
  fetchSourcify,
  fetchSourcifyWithStatus,
  buildSourcifyFields,
  SOURCIFY_V2_FIELDS,
} from '../../src/sources/sourcify'

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

describe('fetchSourcify', () => {
  const chainId = 1
  const address = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

  it('fetches and parses sourcify response with natspec', async () => {
    const response = {
      name: 'WETH9',
      abi: [{ type: 'function', name: 'deposit' }],
      userdoc: {
        methods: {
          'deposit()': { notice: 'Deposit ETH to get WETH' },
        },
      },
      devdoc: {
        methods: {
          'deposit()': { details: 'Wraps ETH into WETH' },
        },
      },
    }
    const fetchFn = mockFetch(response)

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test')

    expect(result).toBeTruthy()
    expect(result!.abi).toEqual([{ type: 'function', name: 'deposit' }])
    expect(result!.actions?.deposit).toBeTruthy()
    expect(result!.actions?.deposit?.function).toBe('deposit')
    expect(result!.actions?.deposit?.description).toBe('Deposit ETH to get WETH')
    // Raw natspec preserved
    expect(result!.userdoc).toEqual(response.userdoc)
    expect(result!.devdoc).toEqual(response.devdoc)
  })

  it('returns null on 404', async () => {
    const result = await fetchSourcify(chainId, address, mockFetch(null, 404))
    expect(result).toBeNull()
  })

  it('reports notFound status on 404', async () => {
    const result = await fetchSourcifyWithStatus(chainId, address, mockFetch(null, 404))

    expect(result).toEqual({ result: null, notFound: true })
  })

  it('throws on non-404 error', async () => {
    await expect(fetchSourcify(chainId, address, mockFetch(null, 500)))
      .rejects.toThrow('500')
  })

  it('handles response with only abi', async () => {
    const response = {
      abi: [{ type: 'function', name: 'transfer' }],
      userdoc: { methods: {} },
      devdoc: { methods: {} },
    }
    const fetchFn = mockFetch(response)

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test')
    expect(result).toBeTruthy()
    expect(result!.abi).toBeTruthy()
    expect(result!.actions).toBeUndefined()
  })

  it('constructs URL with base fields by default', async () => {
    const fetchFn = mockFetch({ userdoc: { methods: {} }, devdoc: { methods: {} } })

    await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test')

    expect(fetchFn).toHaveBeenCalledWith(
      `https://sourcify.test/v2/contract/${chainId}/${address}?fields=abi,userdoc,devdoc`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('appends extra fields when requested', async () => {
    const fetchFn = mockFetch({ userdoc: { methods: {} }, devdoc: { methods: {} } })

    await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test', ['runtimeBytecode', 'sources'])

    expect(fetchFn).toHaveBeenCalledWith(
      `https://sourcify.test/v2/contract/${chainId}/${address}?fields=abi,userdoc,devdoc,runtimeBytecode,sources`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('maps runtimeBytecode.onchainBytecode to deployedBytecode', async () => {
    const response = {
      abi: [],
      runtimeBytecode: { onchainBytecode: '0x6060604052' },
      userdoc: { methods: {} },
      devdoc: { methods: {} },
    }
    const fetchFn = mockFetch(response)

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test', ['runtimeBytecode'])
    expect(result!.deployedBytecode).toBe('0x6060604052')
  })

  it('handles malformed natspec shapes without crashing', async () => {
    // Non-record userdoc/devdoc are dropped before the natspec parse (which
    // runs inside the try — any parser throw becomes a clean
    // ContractMetadataFetchError rather than a TypeError escaping the source).
    const fetchFn = mockFetch({
      abi: [{ type: 'function', name: 'deposit' }],
      userdoc: 'garbage',
      devdoc: 42,
    })

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test')
    expect(result!.abi).toEqual([{ type: 'function', name: 'deposit' }])
    expect(result!.userdoc).toBeUndefined()
    expect(result!.devdoc).toBeUndefined()
    expect(result!.actions).toBeUndefined()
  })

  it('rejects non-object JSON bodies as a clean fetch error', async () => {
    await expect(fetchSourcify(chainId, address, mockFetch([1, 2, 3])))
      .rejects.toThrow('Invalid response from Sourcify')
  })

  it('ignores a non-array abi instead of passing it downstream', async () => {
    const fetchFn = mockFetch({
      abi: { not: 'an array' },
      userdoc: { methods: { 'deposit()': { notice: 'hi' } } },
      devdoc: { methods: {} },
    })

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test')
    expect(result!.abi).toBeUndefined()
    expect(result!.actions?.deposit).toBeTruthy()
  })

  it('never sends an invalid field selector, even legacy deployedBytecode', async () => {
    const fetchFn = mockFetch({ userdoc: { methods: {} }, devdoc: { methods: {} } })

    await fetchSourcify(
      chainId, address, fetchFn, 'https://sourcify.test',
      ['deployedBytecode', 'bogusField', 'sources'],
    )

    const url = (fetchFn as any).mock.calls[0][0] as string
    expect(url).toContain('fields=abi,userdoc,devdoc,runtimeBytecode,sources')
    expect(url).not.toContain('deployedBytecode')
    expect(url).not.toContain('bogusField')
  })

  it('flattens source files to path → content map', async () => {
    const response = {
      abi: [],
      sources: {
        'contracts/Token.sol': { content: 'pragma solidity ^0.8.0;' },
        'contracts/lib/Utils.sol': { content: 'library Utils {}' },
      },
      userdoc: { methods: {} },
      devdoc: { methods: {} },
    }
    const fetchFn = mockFetch(response)

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test', ['sources'])
    expect(result!.sources).toEqual({
      'contracts/Token.sol': 'pragma solidity ^0.8.0;',
      'contracts/lib/Utils.sol': 'library Utils {}',
    })
  })
})

describe('buildSourcifyFields', () => {
  // Pin the exact `fields` value per include combination so an invalid
  // Sourcify v2 field selector (like the former `deployedBytecode`, which
  // the live API answers with HTTP 400) can never ship silently again.
  it('pins the fields string for every include combination', () => {
    expect(buildSourcifyFields()).toBe('abi,userdoc,devdoc')
    expect(buildSourcifyFields([])).toBe('abi,userdoc,devdoc')
    expect(buildSourcifyFields(['sources'])).toBe('abi,userdoc,devdoc,sources')
    expect(buildSourcifyFields(['runtimeBytecode'])).toBe('abi,userdoc,devdoc,runtimeBytecode')
    expect(buildSourcifyFields(['sources', 'runtimeBytecode']))
      .toBe('abi,userdoc,devdoc,sources,runtimeBytecode')
    // Legacy alias maps onto the valid selector
    expect(buildSourcifyFields(['deployedBytecode'])).toBe('abi,userdoc,devdoc,runtimeBytecode')
    expect(buildSourcifyFields(['sources', 'deployedBytecode']))
      .toBe('abi,userdoc,devdoc,sources,runtimeBytecode')
    // Duplicates collapse
    expect(buildSourcifyFields(['abi', 'sources', 'sources'])).toBe('abi,userdoc,devdoc,sources')
  })

  it('only ever emits selectors from the known-valid Sourcify v2 field list', () => {
    const combos = [
      undefined,
      ['sources'],
      ['deployedBytecode'],
      ['runtimeBytecode'],
      ['sources', 'deployedBytecode'],
      ['metadata', 'proxyResolution', 'userdoc', 'devdoc'],
      ['totally-made-up', 'deployedBytecode'],
    ]
    for (const combo of combos) {
      for (const field of buildSourcifyFields(combo).split(',')) {
        expect(SOURCIFY_V2_FIELDS.has(field)).toBe(true)
      }
    }
  })

  it('accepts every documented v2 selector', () => {
    for (const field of ['sources', 'abi', 'metadata', 'userdoc', 'devdoc', 'runtimeBytecode', 'creationBytecode', 'proxyResolution', 'storageLayout', 'compilation', 'deployment']) {
      expect(SOURCIFY_V2_FIELDS.has(field)).toBe(true)
    }
    // The invalid selector that caused the live HTTP 400
    expect(SOURCIFY_V2_FIELDS.has('deployedBytecode')).toBe(false)
  })
})
