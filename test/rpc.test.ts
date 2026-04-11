import { describe, it, expect, vi } from 'vitest'
import { ethCall, decodeAbiString } from '../src/rpc'

function mockFetch(result: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }),
  }) as unknown as typeof fetch
}

describe('ethCall', () => {
  it('sends a JSON-RPC eth_call request', async () => {
    const fetchFn = mockFetch('0xresult')

    const result = await ethCall('https://rpc.test', '0xaddr', '0xdata', fetchFn)

    expect(result).toBe('0xresult')
    expect(fetchFn).toHaveBeenCalledWith('https://rpc.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.stringContaining('"method":"eth_call"'),
    })
  })

  it('returns 0x when result is missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1 }),
    }) as unknown as typeof fetch

    const result = await ethCall('https://rpc.test', '0xaddr', '0xdata', fetchFn)
    expect(result).toBe('0x')
  })

  it('throws on RPC error response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        error: { message: 'execution reverted' },
      }),
    }) as unknown as typeof fetch

    await expect(ethCall('https://rpc.test', '0xaddr', '0xdata', fetchFn))
      .rejects.toThrow('execution reverted')
  })

  it('throws on HTTP error', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch

    await expect(ethCall('https://rpc.test', '0xaddr', '0xdata', fetchFn))
      .rejects.toThrow('500')
  })
})

describe('decodeAbiString', () => {
  it('decodes a simple ABI-encoded string', () => {
    // Encoding of "Hello"
    // offset: 0x20 (32)
    // length: 0x05 (5)
    // data: "Hello" padded to 32 bytes
    const hex = '0x'
      + '0000000000000000000000000000000000000000000000000000000000000020' // offset
      + '0000000000000000000000000000000000000000000000000000000000000005' // length
      + '48656c6c6f000000000000000000000000000000000000000000000000000000' // "Hello"

    expect(decodeAbiString(hex)).toBe('Hello')
  })

  it('decodes an empty string', () => {
    const hex = '0x'
      + '0000000000000000000000000000000000000000000000000000000000000020'
      + '0000000000000000000000000000000000000000000000000000000000000000'

    expect(decodeAbiString(hex)).toBe('')
  })

  it('returns empty string for short data', () => {
    expect(decodeAbiString('0x')).toBe('')
    expect(decodeAbiString('0x0000')).toBe('')
  })

  it('decodes a URL string', () => {
    const url = 'https://example.com/metadata.json'
    const urlHex = Array.from(new TextEncoder().encode(url))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .padEnd(64, '0')

    const hex = '0x'
      + '0000000000000000000000000000000000000000000000000000000000000020'
      + url.length.toString(16).padStart(64, '0')
      + urlHex

    expect(decodeAbiString(hex)).toBe(url)
  })
})
