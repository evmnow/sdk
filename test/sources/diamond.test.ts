import { describe, it, expect } from 'vitest'
import {
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  mergeNatspecDocs,
  FACETS_SELECTOR,
  SUPPORTS_INTERFACE_SELECTOR,
  DIAMOND_LOUPE_INTERFACE_ID,
} from '../../src/sources/diamond'
import { word as w, selSlot as selWord, blob } from '../helpers/abi'

describe('constants', () => {
  it('has the canonical ERC-2535 selectors', () => {
    expect(FACETS_SELECTOR).toBe('0x7a0ed627')
    expect(SUPPORTS_INTERFACE_SELECTOR).toBe('0x01ffc9a7')
    expect(DIAMOND_LOUPE_INTERFACE_ID).toBe('0x48e2b093')
  })
})

describe('computeSelector', () => {
  it('matches the known ERC-20 transfer selector', () => {
    expect(computeSelector('transfer(address,uint256)')).toBe('0xa9059cbb')
  })

  it('matches the known ERC-2535 facets() selector', () => {
    expect(computeSelector('facets()')).toBe('0x7a0ed627')
  })

  it('matches the known ERC-165 supportsInterface selector', () => {
    expect(computeSelector('supportsInterface(bytes4)')).toBe('0x01ffc9a7')
  })
})

describe('canonicalSignature', () => {
  it('handles simple functions', () => {
    const sig = canonicalSignature({
      type: 'function',
      name: 'transfer',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
    })
    expect(sig).toBe('transfer(address,uint256)')
  })

  it('handles no-arg functions', () => {
    expect(canonicalSignature({ type: 'function', name: 'facets' })).toBe('facets()')
  })

  it('expands tuples with nested tuples and array suffixes', () => {
    const sig = canonicalSignature({
      type: 'function',
      name: 'submit',
      inputs: [
        {
          type: 'tuple[]',
          components: [
            { type: 'address' },
            {
              type: 'tuple',
              components: [{ type: 'uint256' }, { type: 'bytes32' }],
            },
          ],
        },
        { type: 'uint256' },
      ],
    })
    expect(sig).toBe('submit((address,(uint256,bytes32))[],uint256)')
  })
})

describe('decodeFacets', () => {
  it('decodes a single-facet payload', () => {
    const payload = blob(
      w(0x20),                                                          // outer offset
      w(1),                                                             // N = 1
      w(0x20),                                                          // tuple0 offset (relative to after N)
      w('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),                    // address
      w(0x40),                                                          // bytes4[] offset (relative to tuple)
      w(2),                                                             // 2 selectors
      selWord('0xa9059cbb'),                                            // transfer
      selWord('0x70a08231'),                                            // balanceOf
    )

    const facets = decodeFacets(payload)
    expect(facets).toHaveLength(1)
    expect(facets[0].facetAddress).toBe('0x' + 'aa'.repeat(20))
    expect(facets[0].functionSelectors).toEqual(['0xa9059cbb', '0x70a08231'])
  })

  it('decodes a two-facet payload with different selector counts', () => {
    // Tuple0 at offset 0x80 (after N + 2 tuple offsets = 32 + 2*32 = 96? Let's be explicit.)
    // After N there are 2 tuple-offset words (each 32 bytes).
    // tuple0 base = 32 (N) + 2*32 (offsets) = 96 bytes, but offsets are RELATIVE to after N,
    // so from "head" position = outerOff + 32.
    //
    // Layout from head:
    //   tuple0 at 0x40  (64 bytes — after the 2 offset words)
    //   tuple0 = addr(32) + selOff(32) + sels(32 + M*32)
    //     selOff = 0x40 (bytes4[] follows the two tuple slots)
    //     2 selectors → 32 + 2*32 = 96 bytes for selectors block
    //     total tuple0 size = 64 + 96 = 160 bytes = 0xa0
    //   tuple1 at 0x40 + 0xa0 = 0xe0
    const payload = blob(
      w(0x20),                                                          // outer offset
      w(2),                                                             // N = 2
      w(0x40),                                                          // tuple0 offset
      w(0xe0),                                                          // tuple1 offset
      // tuple0
      w('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      w(0x40),                                                          // selOff (relative to tuple)
      w(2),
      selWord('0x11223344'),
      selWord('0x55667788'),
      // tuple1
      w('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      w(0x40),
      w(1),
      selWord('0xdeadbeef'),
    )

    const facets = decodeFacets(payload)
    expect(facets).toHaveLength(2)
    expect(facets[0]).toEqual({
      facetAddress: '0x' + 'aa'.repeat(20),
      functionSelectors: ['0x11223344', '0x55667788'],
    })
    expect(facets[1]).toEqual({
      facetAddress: '0x' + 'bb'.repeat(20),
      functionSelectors: ['0xdeadbeef'],
    })
  })

  it('throws on out-of-bounds access (truncated payload)', () => {
    const payload = blob(w(0x20), w(5))  // claims 5 facets but gives nothing
    expect(() => decodeFacets(payload)).toThrow(/malformed/)
  })

  it('throws on value too large to fit in a safe integer', () => {
    // First word (outerOffset) has high bits set → value too large
    const payload = blob(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      w(1),
    )
    expect(() => decodeFacets(payload)).toThrow(/malformed/)
  })

  it('throws when facet count exceeds the sanity limit', () => {
    const payload = blob(w(0x20), w(100000))
    expect(() => decodeFacets(payload)).toThrow(/exceeds/)
  })

  it('throws when address upper bytes are non-zero', () => {
    const payload = blob(
      w(0x20),
      w(1),
      w(0x20),
      // Invalid: upper 12 bytes non-zero
      'ff' + '0'.repeat(22) + 'aa'.repeat(20),
      w(0x40),
      w(0),
    )
    expect(() => decodeFacets(payload)).toThrow(/invalid address/)
  })
})

describe('filterAbiBySelectors', () => {
  it('keeps events, errors, and constructors as-is', () => {
    const abi = [
      { type: 'event', name: 'Transfer', inputs: [] },
      { type: 'error', name: 'Unauthorized', inputs: [] },
      { type: 'constructor', inputs: [] },
      { type: 'fallback' },
      { type: 'receive' },
    ]
    expect(filterAbiBySelectors(abi, [])).toEqual(abi)
  })

  it('keeps only functions whose selector matches', () => {
    const abi = [
      { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] }, // 0xa9059cbb
      { type: 'function', name: 'balanceOf', inputs: [{ type: 'address' }] },                     // 0x70a08231
      { type: 'function', name: 'totalSupply', inputs: [] },                                      // 0x18160ddd
    ]
    const filtered = filterAbiBySelectors(abi, ['0xa9059cbb', '0x18160ddd'])
    expect(filtered).toHaveLength(2)
    expect(filtered.map((f: any) => f.name).sort()).toEqual(['totalSupply', 'transfer'])
  })

  it('is case-insensitive on selectors', () => {
    const abi = [
      { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
    ]
    expect(filterAbiBySelectors(abi, ['0xA9059CBB'])).toHaveLength(1)
  })
})

describe('buildCompositeAbi', () => {
  it('dedups functions across facets by selector (first wins)', () => {
    const facetA = [
      { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
      { type: 'function', name: 'balanceOf', inputs: [{ type: 'address' }] },
    ]
    const facetB = [
      // Same selector as facetA's transfer — should be dropped
      { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
      { type: 'function', name: 'totalSupply', inputs: [] },
    ]
    const composite = buildCompositeAbi([facetA, facetB])
    expect(composite).toHaveLength(3)
    expect(composite.map((f: any) => f.name)).toEqual(['transfer', 'balanceOf', 'totalSupply'])
  })

  it('dedups events by type:canonicalSignature', () => {
    const facetA = [
      { type: 'event', name: 'Transfer', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }] },
    ]
    const facetB = [
      { type: 'event', name: 'Transfer', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }] },
      // Same name, different signature — should still be included
      { type: 'event', name: 'Transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
    ]
    const composite = buildCompositeAbi([facetA, facetB])
    expect(composite).toHaveLength(2)
  })

  it('keeps constructors, fallbacks, and receives as-is (no dedup)', () => {
    const facetA = [{ type: 'constructor', inputs: [] }, { type: 'fallback' }]
    const facetB = [{ type: 'constructor', inputs: [] }, { type: 'receive' }]
    const composite = buildCompositeAbi([facetA, facetB])
    expect(composite).toHaveLength(4)
  })
})

describe('mergeNatspecDocs', () => {
  it('returns undefined when all inputs are undefined', () => {
    expect(mergeNatspecDocs(undefined, undefined)).toBeUndefined()
  })

  it('merges methods records per key', () => {
    const a = { methods: { 'foo()': { notice: 'foo from A' } } }
    const b = { methods: { 'bar()': { notice: 'bar from B' } } }
    const merged = mergeNatspecDocs(a, b)
    expect(merged).toEqual({
      methods: {
        'foo()': { notice: 'foo from A' },
        'bar()': { notice: 'bar from B' },
      },
    })
  })

  it('first non-undefined wins for scalar fields', () => {
    const a = { notice: 'A wins' }
    const b = { notice: 'B loses', details: 'B fills in' }
    expect(mergeNatspecDocs(a, b)).toEqual({ notice: 'A wins', details: 'B fills in' })
  })
})
