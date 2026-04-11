import { describe, it, expect, vi } from 'vitest'
import { fetchRepository } from '../../src/sources/repository'

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

describe('fetchRepository', () => {
  const chainId = 1
  const address = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

  it('fetches metadata from repository URL', async () => {
    const metadata = { name: 'WETH', functions: { deposit: { title: 'Deposit' } } }
    const fetchFn = mockFetch(metadata)

    const result = await fetchRepository(chainId, address, fetchFn, 'https://repo.test/contracts')

    expect(result).toEqual(metadata)
    expect(fetchFn).toHaveBeenCalledWith(
      `https://repo.test/contracts/${address}.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('returns null on 404', async () => {
    const result = await fetchRepository(chainId, address, mockFetch(null, 404))
    expect(result).toBeNull()
  })

  it('throws on non-404 error', async () => {
    await expect(fetchRepository(chainId, address, mockFetch(null, 500)))
      .rejects.toThrow('500')
  })

  it('uses address as-is (caller is responsible for lowercasing)', async () => {
    const fetchFn = mockFetch({ name: 'Test' })
    await fetchRepository(chainId, address, fetchFn, 'https://repo.test')

    expect(fetchFn).toHaveBeenCalledWith(
      `https://repo.test/${address}.json`,
      expect.any(Object),
    )
  })
})
