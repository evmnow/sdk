import { describe, it, expect } from 'vitest'
import { namehash, dnsEncode } from '../src/ens'

describe('namehash', () => {
  it('returns zero hash for empty string', () => {
    expect(namehash('')).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  it('computes namehash for eth', () => {
    // keccak256(bytes32(0) + keccak256('eth'))
    expect(namehash('eth')).toBe(
      '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
    )
  })

  it('computes namehash for foo.eth', () => {
    expect(namehash('foo.eth')).toBe(
      '0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f',
    )
  })

  it('computes namehash for vitalik.eth', () => {
    expect(namehash('vitalik.eth')).toBe(
      '0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835',
    )
  })
})

describe('dnsEncode', () => {
  it('encodes single label', () => {
    // 'eth' -> 03 65 74 68 00
    expect(dnsEncode('eth')).toBe('0x0365746800')
  })

  it('encodes multi-label name', () => {
    // 'foo.eth' -> 03 66 6f 6f 03 65 74 68 00
    expect(dnsEncode('foo.eth')).toBe('0x03666f6f0365746800')
  })
})
