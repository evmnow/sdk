import { describe, it, expect, vi } from 'vitest'
import { fetchSourcify, fetchSourcifyWithStatus } from '../../src/sources/sourcify'

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
    expect(result!.functions?.deposit).toBeTruthy()
    expect(result!.functions?.deposit?.description).toBe('Deposit ETH to get WETH')
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
    expect(result!.functions).toBeUndefined()
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

    await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test', ['deployedBytecode', 'sources'])

    expect(fetchFn).toHaveBeenCalledWith(
      `https://sourcify.test/v2/contract/${chainId}/${address}?fields=abi,userdoc,devdoc,deployedBytecode,sources`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('includes deployed bytecode when available', async () => {
    const response = {
      abi: [],
      deployedBytecode: '0x6060604052',
      userdoc: { methods: {} },
      devdoc: { methods: {} },
    }
    const fetchFn = mockFetch(response)

    const result = await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test', ['deployedBytecode'])
    expect(result!.deployedBytecode).toBe('0x6060604052')
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
