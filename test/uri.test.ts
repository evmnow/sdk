import { describe, it, expect, vi } from 'vitest'
import { resolveUri } from '../src/uri'

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
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

  it('returns null for unknown URI scheme', async () => {
    const result = await resolveUri('ftp://example.com', mockFetch(null))
    expect(result).toBeNull()
  })
})
