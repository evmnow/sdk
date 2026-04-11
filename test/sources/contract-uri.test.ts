import { describe, it, expect, vi } from 'vitest'
import { fetchContractURI } from '../../src/sources/contract-uri'

// Encode a string as ABI return value
function abiEncodeString(str: string): string {
  const hex = Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
  return '0x'
    + '0000000000000000000000000000000000000000000000000000000000000020'
    + str.length.toString(16).padStart(64, '0')
    + padded
}

describe('fetchContractURI', () => {
  const chainId = 1
  const address = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  const rpc = 'https://rpc.test'

  it('fetches and resolves a data URI contractURI', async () => {
    const metadata = { name: 'Test Contract', symbol: 'TC', description: 'A test' }
    const dataUri = `data:application/json;base64,${btoa(JSON.stringify(metadata))}`
    const abiResult = abiEncodeString(dataUri)

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: abiResult }),
    }) as unknown as typeof fetch

    const result = await fetchContractURI(chainId, address, rpc, fetchFn)

    expect(result).toEqual({
      name: 'Test Contract',
      symbol: 'TC',
      description: 'A test',
    })
  })

  it('extracts only ERC-7572 fields', async () => {
    const metadata = {
      name: 'Test',
      symbol: 'T',
      functions: { transfer: {} }, // not an ERC-7572 field
      custom: 'value',             // not an ERC-7572 field
    }
    const dataUri = `data:application/json;base64,${btoa(JSON.stringify(metadata))}`
    const abiResult = abiEncodeString(dataUri)

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: abiResult }),
    }) as unknown as typeof fetch

    const result = await fetchContractURI(chainId, address, rpc, fetchFn)

    expect(result).toEqual({ name: 'Test', symbol: 'T' })
    expect(result).not.toHaveProperty('functions')
    expect(result).not.toHaveProperty('custom')
  })

  it('returns null when eth_call fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        error: { message: 'execution reverted' },
      }),
    }) as unknown as typeof fetch

    const result = await fetchContractURI(chainId, address, rpc, fetchFn)
    expect(result).toBeNull()
  })

  it('returns null when result is empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x' }),
    }) as unknown as typeof fetch

    const result = await fetchContractURI(chainId, address, rpc, fetchFn)
    expect(result).toBeNull()
  })
})
