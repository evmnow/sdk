import { keccak_256 } from '@noble/hashes/sha3'
import { ethCall } from '../rpc'
import { isRecord } from '../merge'
import { ContractMetadataFetchError } from '../errors'

export const DIAMOND_LOUPE_INTERFACE_ID = '0x48e2b093'
export const SUPPORTS_INTERFACE_SELECTOR = '0x01ffc9a7'
export const FACETS_SELECTOR = '0x7a0ed627'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Sanity limits to reject malformed data that accidentally decodes.
// Real diamonds have <100 facets and <200 selectors/facet; bound malformed-input cost.
const MAX_FACETS = 200
const MAX_SELECTORS_PER_FACET = 1000

const encoder = new TextEncoder()

export interface RawFacet {
  facetAddress: string
  functionSelectors: string[]
}

/**
 * Detect whether a contract implements ERC-2535 (Diamond) and return its facets.
 * Returns null if not a diamond. Returns a non-empty array of facets otherwise.
 *
 * Strategy:
 *   1. Try ERC-165 supportsInterface(0x48e2b093).
 *      - Valid bool `true`  → fetch and return facets
 *      - Valid bool `false` → definitively not a diamond (null)
 *      - Malformed / error  → fall through to step 2
 *   2. Probe `facets()` directly. If it returns a non-empty decoded array, it's a diamond.
 */
export async function detectAndFetchFacets(
  rpc: string,
  address: string,
  fetchFn: typeof fetch,
): Promise<RawFacet[] | null> {
  const calldata = SUPPORTS_INTERFACE_SELECTOR
    + DIAMOND_LOUPE_INTERFACE_ID.slice(2).padEnd(64, '0')

  try {
    const res = await ethCall(rpc, address, calldata, fetchFn)
    const bool = parseBool(res)
    if (bool === true) return tryFacets(rpc, address, fetchFn)
    if (bool === false) return null
    // Malformed response — fall through to facets() probe
  } catch {
    // RPC/revert error — fall through to facets() probe
  }

  return tryFacets(rpc, address, fetchFn)
}

async function tryFacets(
  rpc: string,
  address: string,
  fetchFn: typeof fetch,
): Promise<RawFacet[] | null> {
  let res: string
  try {
    res = await ethCall(rpc, address, FACETS_SELECTOR, fetchFn)
  } catch {
    return null
  }

  if (res === '0x' || res.length < 130) return null

  let facets: RawFacet[]
  try {
    facets = decodeFacets(res)
  } catch {
    return null
  }

  // Zero-address facets indicate deleted selectors; exclude from results.
  const live = facets.filter(f => f.facetAddress !== ZERO_ADDRESS)
  return live.length > 0 ? live : null
}

/**
 * Parse a 32-byte ABI-encoded bool. Returns null if the response is not a
 * well-formed bool (wrong length, or non-zero high bits).
 */
function parseBool(hex: string): boolean | null {
  if (hex.length !== 66) return null
  const body = hex.slice(2).toLowerCase()
  if (!/^0{63}[01]$/.test(body)) return null
  return body.slice(-1) === '1'
}

/**
 * Decode the return value of `facets()` — type `(address, bytes4[])[]`.
 * Throws ContractMetadataFetchError on malformed input.
 */
export function decodeFacets(hex: string): RawFacet[] {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const W = 64 // one 32-byte word in hex chars

  const readWord = (pos: number): string => {
    if (pos < 0 || pos + W > h.length) {
      throw new ContractMetadataFetchError('rpc', 0, 'malformed facets() return: out of bounds')
    }
    return h.slice(pos, pos + W)
  }

  const readUint = (pos: number): number => {
    const word = readWord(pos)
    // Upper 24 bytes must be zero for the value to fit safely in a JS number
    if (!/^0{48}/.test(word)) {
      throw new ContractMetadataFetchError('rpc', 0, 'malformed facets() return: value too large')
    }
    return parseInt(word, 16)
  }

  const outerOff = readUint(0) * 2
  const n = readUint(outerOff)
  if (n > MAX_FACETS) {
    throw new ContractMetadataFetchError('rpc', 0, `malformed facets() return: ${n} facets exceeds limit`)
  }

  const head = outerOff + W
  const facets: RawFacet[] = []

  for (let i = 0; i < n; i++) {
    const tupleOff = readUint(head + i * W) * 2
    const tx = head + tupleOff

    const addrWord = readWord(tx)
    if (!/^0{24}/.test(addrWord)) {
      throw new ContractMetadataFetchError('rpc', 0, 'malformed facets() return: invalid address')
    }
    const facetAddress = '0x' + addrWord.slice(24).toLowerCase()

    const selOff = readUint(tx + W) * 2
    const selStart = tx + selOff

    const m = readUint(selStart)
    if (m > MAX_SELECTORS_PER_FACET) {
      throw new ContractMetadataFetchError('rpc', 0, `malformed facets() return: ${m} selectors exceeds limit`)
    }

    const selectors: string[] = []
    for (let j = 0; j < m; j++) {
      const slot = readWord(selStart + W + j * W)
      selectors.push('0x' + slot.slice(0, 8).toLowerCase())
    }

    facets.push({ facetAddress, functionSelectors: selectors })
  }

  return facets
}

/**
 * Compute the 4-byte selector for a canonical function signature.
 * Example: computeSelector('transfer(address,uint256)') → '0xa9059cbb'
 */
export function computeSelector(signature: string): string {
  const hash = keccak_256(encoder.encode(signature))
  let hex = '0x'
  for (let i = 0; i < 4; i++) {
    hex += hash[i].toString(16).padStart(2, '0')
  }
  return hex
}

interface AbiParam {
  type: string
  components?: AbiParam[]
}

interface AbiFunctionLike {
  type: string
  name?: string
  inputs?: AbiParam[]
}

/**
 * Build the canonical signature for an ABI function/event/error entry,
 * recursively expanding `tuple` into `(innerTypes)` while preserving any
 * `[]` or `[N]` array suffix. This is the form hashed to produce selectors.
 */
export function canonicalSignature(fn: AbiFunctionLike): string {
  if (!fn.name) throw new Error('Cannot build signature: entry has no name')
  const types = (fn.inputs ?? []).map(canonicalType).join(',')
  return `${fn.name}(${types})`
}

function canonicalType(p: AbiParam): string {
  if (p.type.startsWith('tuple')) {
    const suffix = p.type.slice('tuple'.length)
    const inner = (p.components ?? []).map(canonicalType).join(',')
    return `(${inner})${suffix}`
  }
  return p.type
}

/**
 * Keep all non-function ABI entries; keep function entries whose computed selector
 * is in the provided selector set. Verified facet contracts may declare extra
 * functions not actually mounted on the diamond — this trims them.
 */
export function filterAbiBySelectors(abi: unknown[], selectors: string[]): unknown[] {
  const set = new Set(selectors.map(s => s.toLowerCase()))

  return abi.filter(item => {
    if (!isAbiFunction(item)) return true
    try {
      const sel = computeSelector(canonicalSignature(item)).toLowerCase()
      return set.has(sel)
    } catch {
      return false
    }
  })
}

/**
 * Combine multiple ABIs into a single composite, first-occurrence wins:
 *   - functions deduped by selector
 *   - events and errors deduped by `type:name(canonicalInputs)`
 *   - other entries (constructor, fallback, receive) kept as-is
 */
export function buildCompositeAbi(abis: unknown[][]): unknown[] {
  const seenSelectors = new Set<string>()
  const seenEventErrors = new Set<string>()
  const composite: unknown[] = []

  for (const abi of abis) {
    for (const item of abi) {
      if (isAbiFunction(item)) {
        try {
          const sel = computeSelector(canonicalSignature(item)).toLowerCase()
          if (seenSelectors.has(sel)) continue
          seenSelectors.add(sel)
        } catch {
          // Include items we can't key
        }
      } else if (isEventOrError(item)) {
        try {
          const key = `${item.type}:${canonicalSignature(item)}`
          if (seenEventErrors.has(key)) continue
          seenEventErrors.add(key)
        } catch {
          // Include items we can't key
        }
      }
      composite.push(item)
    }
  }

  return composite
}

/**
 * Shallow-merge NatSpec userdoc/devdoc objects across main diamond + facets.
 * Record sections (methods, events, errors) merge per key; scalar fields take
 * first non-undefined. Uses first-wins priority because callers pass the main
 * diamond's docs first (highest authority) followed by facets.
 */
export function mergeNatspecDocs(
  ...docs: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  const present = docs.filter((d): d is Record<string, unknown> => d !== undefined && d !== null)
  if (present.length === 0) return undefined

  const recordKeys = new Set(['methods', 'events', 'errors'])
  const merged: Record<string, unknown> = {}

  for (const doc of present) {
    for (const [key, value] of Object.entries(doc)) {
      if (value === undefined) continue
      if (recordKeys.has(key) && isRecord(value)) {
        const existing = isRecord(merged[key]) ? (merged[key] as Record<string, unknown>) : {}
        merged[key] = { ...existing, ...value }
      } else if (merged[key] === undefined) {
        merged[key] = value
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function isAbiFunction(item: unknown): item is AbiFunctionLike {
  return typeof item === 'object'
    && item !== null
    && (item as { type?: unknown }).type === 'function'
    && typeof (item as { name?: unknown }).name === 'string'
}

function isEventOrError(item: unknown): item is AbiFunctionLike {
  if (typeof item !== 'object' || item === null) return false
  const t = (item as { type?: unknown }).type
  return (t === 'event' || t === 'error')
    && typeof (item as { name?: unknown }).name === 'string'
}
