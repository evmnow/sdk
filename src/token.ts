import { ethCall, decodeAbiString } from './rpc'
import type { TokenInfo } from './format'

// ── Token identity resolution ──
//
// `token-amount` renders with the token's on-chain `decimals()` and `symbol()`
// — the metadata standard never carries them as config. This module is the
// canonical resolver: it reads both values over JSON-RPC, caches successes
// (they are immutable in virtually all deployed tokens), and returns `null`
// when decimals cannot be resolved so callers render the raw value instead of
// guessing (per the standard, consumers MUST NOT substitute default decimals).

const DECIMALS_SELECTOR = '0x313ce567' // decimals()
const SYMBOL_SELECTOR = '0x95d89b41' // symbol()

// A hostile token can return anything from symbol(); keep it display-safe.
const MAX_SYMBOL_LENGTH = 20

export interface TokenInfoResolverConfig {
  /** JSON-RPC endpoint of the chain the tokens live on. */
  rpc: string
  /** Custom fetch implementation (tests, proxies). Default: global fetch. */
  fetchFn?: typeof fetch
}

export interface TokenInfoResolver {
  /**
   * Resolve `{ decimals, symbol }` for a token contract. Returns `null` when
   * decimals cannot be resolved — render the raw value in that case. Successes
   * are cached for the resolver's lifetime; failures are retried on the next
   * call (they may be transient RPC errors).
   */
  resolve(address: string): Promise<TokenInfo | null>
  /** Resolve many tokens concurrently; unresolvable ones are omitted from the map. */
  resolveAll(addresses: string[]): Promise<Map<string, TokenInfo>>
}

export function createTokenInfoResolver(config: TokenInfoResolverConfig): TokenInfoResolver {
  const { rpc } = config
  const fetchFn = config.fetchFn ?? fetch
  const cache = new Map<string, TokenInfo>()
  const inflight = new Map<string, Promise<TokenInfo | null>>()

  async function lookup(address: string): Promise<TokenInfo | null> {
    // Both reads are independent — issue them concurrently. symbol() is
    // optional (decimals alone still formats correctly), so its failure is
    // swallowed; a failed decimals() read makes the token unresolvable.
    const [decimalsHex, symbolHex] = await Promise.all([
      ethCall(rpc, address, DECIMALS_SELECTOR, fetchFn).catch(() => null),
      ethCall(rpc, address, SYMBOL_SELECTOR, fetchFn).catch(() => null),
    ])

    if (decimalsHex === null) return null
    const decimals = decodeDecimals(decimalsHex)
    if (decimals === null) return null

    const symbol = symbolHex === null ? undefined : decodeSymbol(symbolHex) ?? undefined

    return symbol === undefined ? { decimals } : { decimals, symbol }
  }

  function resolve(address: string): Promise<TokenInfo | null> {
    const key = address.toLowerCase()
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)

    const pending = inflight.get(key)
    if (pending) return pending

    const promise = lookup(key).then(
      (info) => {
        inflight.delete(key)
        if (info) cache.set(key, info)
        return info
      },
      (error) => {
        inflight.delete(key)
        throw error
      },
    )
    inflight.set(key, promise)
    return promise
  }

  async function resolveAll(addresses: string[]): Promise<Map<string, TokenInfo>> {
    const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
    const entries = await Promise.all(
      unique.map(async (address) => [address, await resolve(address)] as const),
    )
    const map = new Map<string, TokenInfo>()
    for (const [address, info] of entries) {
      if (info) map.set(address, info)
    }
    return map
  }

  return { resolve, resolveAll }
}

/** Decode a `decimals()` return word. ERC-20 declares uint8; reject anything outside it. */
function decodeDecimals(hex: string): number | null {
  if (!hex || hex === '0x') return null
  let value: bigint
  try {
    value = BigInt(hex)
  } catch {
    return null
  }
  if (value < 0n || value > 255n) return null
  return Number(value)
}

/**
 * Decode a `symbol()`-style string return — a dynamic ABI string, or a fixed
 * bytes32 word for legacy tokens (MKR, SAI). Also fits `name()` — pass a
 * larger `maxLength`. Output is sanitized via {@link sanitizeSymbol}.
 */
export function decodeSymbol(
  hex: string,
  maxLength: number = MAX_SYMBOL_LENGTH,
): string | null {
  if (!hex || hex === '0x') return null

  const dynamic = decodeAbiString(hex)
  if (dynamic) return sanitizeSymbol(dynamic, maxLength)

  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length === 64) {
    const bytes: number[] = []
    for (let i = 0; i < 64; i += 2) {
      const byte = parseInt(h.slice(i, i + 2), 16)
      if (byte === 0) break
      bytes.push(byte)
    }
    if (bytes.length) {
      return sanitizeSymbol(new TextDecoder().decode(new Uint8Array(bytes)), maxLength)
    }
  }

  return null
}

/**
 * Make an on-chain string display-safe: strip control characters, trim, and
 * cap the length. Returns null when nothing displayable remains.
 */
export function sanitizeSymbol(
  raw: string,
  maxLength: number = MAX_SYMBOL_LENGTH,
): string | null {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}
