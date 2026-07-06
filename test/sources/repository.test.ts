import { describe, it, expect, vi } from 'vitest'
import { fetchRepository } from '../../src/sources/repository'

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

/** Routes by exact URL; anything unmatched 404s. */
function mockFetchRoutes(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    if (url in routes) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(routes[url]),
      }
    }
    return { ok: false, status: 404, json: () => Promise.resolve(null) }
  }) as unknown as typeof fetch
}

describe('fetchRepository', () => {
  const chainId = 1
  const address = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

  it('fetches metadata from the chain-scoped repository layout', async () => {
    const metadata = { name: 'WETH', actions: { deposit: { function: 'deposit', title: 'Deposit' } } }
    const fetchFn = mockFetchRoutes({
      [`https://repo.test/contracts/${chainId}/${address}.json`]: metadata,
    })

    const result = await fetchRepository(chainId, address, fetchFn, 'https://repo.test/contracts')

    expect(result).toEqual(metadata)
    expect((fetchFn as any).mock.calls[0][0]).toBe(
      `https://repo.test/contracts/${chainId}/${address}.json`,
    )
  })

  it('falls back to the legacy flat layout when the chain-scoped file is missing', async () => {
    const metadata = { name: 'WETH (flat)' }
    const fetchFn = mockFetchRoutes({
      [`https://repo.test/contracts/${address}.json`]: metadata,
    })

    const result = await fetchRepository(chainId, address, fetchFn, 'https://repo.test/contracts')

    expect(result).toEqual(metadata)
    const urls = (fetchFn as any).mock.calls.map((c: any) => c[0])
    expect(urls).toEqual([
      `https://repo.test/contracts/${chainId}/${address}.json`,
      `https://repo.test/contracts/${address}.json`,
    ])
  })

  it('discards a document whose chainId disagrees with the requested chain', async () => {
    const fetchFn = mockFetchRoutes({
      [`https://repo.test/contracts/${address}.json`]: { chainId: 10, name: 'Optimism doc' },
    })

    const result = await fetchRepository(chainId, address, fetchFn, 'https://repo.test/contracts')
    expect(result).toBeNull()
  })

  it('keeps a document whose chainId matches the requested chain', async () => {
    const fetchFn = mockFetchRoutes({
      [`https://repo.test/contracts/${chainId}/${address}.json`]: { chainId: 1, name: 'Mainnet doc' },
    })

    const result = await fetchRepository(chainId, address, fetchFn, 'https://repo.test/contracts')
    expect(result).toEqual({ chainId: 1, name: 'Mainnet doc' })
  })

  it('returns null on 404', async () => {
    const result = await fetchRepository(chainId, address, mockFetch(null, 404))
    expect(result).toBeNull()
  })

  it('throws on non-404 error', async () => {
    await expect(fetchRepository(chainId, address, mockFetch(null, 500)))
      .rejects.toThrow('500')
  })

  it('returns null for a JSON array response instead of crashing downstream', async () => {
    const result = await fetchRepository(chainId, address, mockFetch([{ name: 'nope' }]))
    expect(result).toBeNull()
  })

  it('returns null for non-object JSON responses', async () => {
    expect(await fetchRepository(chainId, address, mockFetch('a string'))).toBeNull()
    expect(await fetchRepository(chainId, address, mockFetch(42))).toBeNull()
    expect(await fetchRepository(chainId, address, mockFetch(null))).toBeNull()
  })

  it('returns null when includes is not an array of strings', async () => {
    expect(
      await fetchRepository(chainId, address, mockFetch({ name: 'X', includes: 'erc20' })),
    ).toBeNull()
    expect(
      await fetchRepository(chainId, address, mockFetch({ name: 'X', includes: [1, 2] })),
    ).toBeNull()
    // Valid includes pass through
    expect(
      await fetchRepository(chainId, address, mockFetch({ name: 'X', includes: ['erc20'] })),
    ).toEqual({ name: 'X', includes: ['erc20'] })
  })

  it('uses address as-is (caller is responsible for lowercasing)', async () => {
    const fetchFn = mockFetch({ name: 'Test' })
    await fetchRepository(chainId, address, fetchFn, 'https://repo.test')

    expect(fetchFn).toHaveBeenCalledWith(
      `https://repo.test/${chainId}/${address}.json`,
      expect.any(Object),
    )
  })
})
