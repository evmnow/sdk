import { describe, it, expect, vi } from 'vitest'
import { resolveUri } from '../src/uri'

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch
}

describe('resolveUri', () => {
  it('parses base64 data URI', async () => {
    const json = { name: 'Test' }
    const b64 = btoa(JSON.stringify(json))
    const uri = `data:application/json;base64,${b64}`

    const result = await resolveUri(uri, mockFetch(null))
    expect(result).toEqual(json)
  })

  it('parses utf8 data URI', async () => {
    const json = { name: 'Test' }
    const uri = `data:application/json;utf8,${encodeURIComponent(JSON.stringify(json))}`

    const result = await resolveUri(uri, mockFetch(null))
    expect(result).toEqual(json)
  })

  it('parses plain data URI', async () => {
    const json = { name: 'Test' }
    const uri = `data:application/json,${encodeURIComponent(JSON.stringify(json))}`

    const result = await resolveUri(uri, mockFetch(null))
    expect(result).toEqual(json)
  })

  it('fetches HTTPS URI', async () => {
    const json = { name: 'Remote' }
    const fetchFn = mockFetch(json)

    const result = await resolveUri('https://example.com/meta.json', fetchFn)
    expect(result).toEqual(json)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/meta.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('returns null for non-ok HTTPS response', async () => {
    const result = await resolveUri('https://example.com/meta.json', mockFetch(null, 404))
    expect(result).toBeNull()
  })

  it('fetches IPFS URI via gateway', async () => {
    const json = { name: 'IPFS' }
    const fetchFn = mockFetch(json)

    const result = await resolveUri('ipfs://QmTest123', fetchFn, 'https://gateway.pinata.cloud')
    expect(result).toEqual(json)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://gateway.pinata.cloud/ipfs/QmTest123',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('parses the charset=utf-8 data URI variant', async () => {
    const json = { name: 'Test' }
    const uri = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(json))}`

    const result = await resolveUri(uri, mockFetch(null))
    expect(result).toEqual(json)
  })

  it('rejects oversized responses via content-length', async () => {
    const fetchFn = mockFetch({ name: 'huge' }, 200, { 'content-length': String(5_000_000) })

    const result = await resolveUri('https://example.com/meta.json', fetchFn)
    expect(result).toBeNull()
  })

  it('rejects oversized response bodies even without content-length', async () => {
    const huge = { name: 'x'.repeat(1_100_000) }
    const result = await resolveUri('https://example.com/meta.json', mockFetch(huge))
    expect(result).toBeNull()
  })

  it('returns null for unknown URI scheme', async () => {
    const result = await resolveUri('ftp://example.com', mockFetch(null))
    expect(result).toBeNull()
  })
})
