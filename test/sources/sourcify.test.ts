import { describe, it, expect, vi } from 'vitest'
import { fetchSourcify } from '../../src/sources/sourcify'

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
    expect(result!.name).toBe('WETH9')
    expect(result!.abi).toEqual([{ type: 'function', name: 'deposit' }])
    expect(result!.functions?.deposit).toBeTruthy()
    expect(result!.functions?.deposit?.description).toBe('Deposit ETH to get WETH')
  })

  it('returns null on 404', async () => {
    const result = await fetchSourcify(chainId, address, mockFetch(null, 404))
    expect(result).toBeNull()
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

  it('constructs correct URL with fields', async () => {
    const fetchFn = mockFetch({ userdoc: { methods: {} }, devdoc: { methods: {} } })

    await fetchSourcify(chainId, address, fetchFn, 'https://sourcify.test')

    expect(fetchFn).toHaveBeenCalledWith(
      `https://sourcify.test/v2/contract/${chainId}/${address}?fields=abi,name,userdoc,devdoc`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
