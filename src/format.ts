import type { ParamType } from './types'

// ── Amount-like types ──
//
// `eth`, `gwei`, `token-amount`, and `amount` share one formatting contract:
// display value = raw integer / 10^decimals, rendered with a symbol. They differ
// only in where `decimals` and `symbol` come from:
//
//   | type         | decimals              | symbol            |
//   | ------------ | --------------------- | ----------------- |
//   | eth          | 18 (fixed)            | ETH (fixed)       |
//   | gwei         | 9 (fixed)             | gwei (fixed)      |
//   | token-amount | on-chain decimals()   | on-chain symbol() |
//   | amount       | `decimals` (def. 18)  | `symbol` (opt.)   |
//
// This module is pure and dependency-free — it is the canonical implementation
// of that contract, safe to use in any runtime (browser, server, worker).

export type AmountKind = 'eth' | 'gwei' | 'token-amount' | 'amount'

/** On-chain token identity, resolved by the caller for `token-amount`. */
export interface TokenInfo {
  decimals: number
  symbol?: string
}

/** The resolved `{ decimals, symbol }` an amount-like value should render with. */
export interface AmountDisplay {
  decimals: number
  symbol?: string
}

/**
 * Return the amount-like kind of a semantic type, or `null` if the type is not
 * amount-like. Works regardless of whether token info has been resolved yet.
 */
export function amountKind(type: ParamType | undefined | null): AmountKind | null {
  if (!type) return null
  if (typeof type === 'string') {
    return type === 'eth' || type === 'gwei' || type === 'token-amount' ? type : null
  }
  if (type.type === 'amount') return 'amount'
  if (type.type === 'token-amount') return 'token-amount'
  return null
}

/** Whether a semantic type follows the amount-like formatting contract. */
export function isAmountType(type: ParamType | undefined | null): boolean {
  return amountKind(type) !== null
}

/**
 * Resolve the `{ decimals, symbol }` an amount-like type renders with.
 *
 * For `token-amount`, pass the resolved on-chain `tokenInfo`. When it is not
 * available this returns `null`: per the standard, consumers MUST NOT substitute
 * default decimals for an unresolved token — guessing displays a wrong number.
 * Render the raw base-unit value instead and indicate the token is unresolved.
 *
 * Returns `null` for non-amount types.
 */
export function resolveAmountDisplay(
  type: ParamType | undefined | null,
  tokenInfo?: TokenInfo,
): AmountDisplay | null {
  const kind = amountKind(type)
  if (!kind) return null

  switch (kind) {
    case 'eth':
      return { decimals: 18, symbol: 'ETH' }
    case 'gwei':
      return { decimals: 9, symbol: 'gwei' }
    case 'token-amount':
      return tokenInfo
        ? { decimals: tokenInfo.decimals, symbol: tokenInfo.symbol }
        : null
    case 'amount': {
      // `amount` is only ever an object form; narrow past the string branch.
      const obj = type as { type: 'amount'; decimals?: number; symbol?: string }
      return { decimals: obj.decimals ?? 18, symbol: obj.symbol }
    }
  }
}

// ── Raw ⇄ decimal conversion ──

function toBigInt(raw: bigint | string | number): bigint {
  if (typeof raw === 'bigint') return raw
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new Error(`formatUnits expects an integer, received ${raw}`)
    }
    return BigInt(raw)
  }
  const trimmed = raw.trim()
  return BigInt(trimmed)
}

/**
 * Convert a raw base-unit integer to an exact decimal string.
 * Inverse of {@link parseUnits}. No rounding, no grouping, no symbol.
 *
 * ```ts
 * formatUnits(1500000000000000000n, 18) // "1.5"
 * ```
 */
export function formatUnits(raw: bigint | string | number, decimals: number): string {
  return toDecimalString(toBigInt(raw), decimals)
}

/**
 * Parse a human decimal string into a raw base-unit integer.
 * Inverse of {@link formatUnits}. Extra fractional precision beyond `decimals`
 * is rounded half-up.
 *
 * ```ts
 * parseUnits('1.5', 18) // 1500000000000000000n
 * ```
 */
export function parseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
    throw new Error(`Invalid amount: "${value}"`)
  }

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [wholePart = '', fracPart = ''] = unsigned.split('.')
  const whole = wholePart || '0'

  let digits: string
  if (fracPart.length <= decimals) {
    digits = whole + fracPart.padEnd(decimals, '0')
  } else {
    // More precision than the unit supports — keep `decimals`, round half-up.
    const keep = fracPart.slice(0, decimals)
    const roundUp = Number(fracPart[decimals]) >= 5
    let raw = BigInt(whole + keep)
    if (roundUp) raw += 1n
    return negative ? -raw : raw
  }

  const raw = BigInt(digits)
  return negative ? -raw : raw
}

/**
 * Render `raw` as a decimal string with `decimals` places, optionally capping
 * fractional digits at `maxDecimals` (rounded half-up) and stripping trailing
 * zeros.
 */
function toDecimalString(raw: bigint, decimals: number, maxDecimals?: number): string {
  const negative = raw < 0n
  let value = negative ? -raw : raw
  let places = decimals

  if (maxDecimals !== undefined && maxDecimals < decimals) {
    const shift = 10n ** BigInt(decimals - maxDecimals)
    const quotient = value / shift
    const remainder = value % shift
    // round half-up
    value = remainder * 2n >= shift ? quotient + 1n : quotient
    places = maxDecimals
  }

  const base = 10n ** BigInt(places)
  const whole = value / base
  const frac = value % base

  let out = whole.toString()
  if (places > 0 && frac > 0n) {
    const fracStr = frac.toString().padStart(places, '0').replace(/0+$/, '')
    if (fracStr) out += '.' + fracStr
  }

  return negative && value !== 0n ? '-' + out : out
}

function groupInteger(intPart: string): string {
  const negative = intPart.startsWith('-')
  const digits = negative ? intPart.slice(1) : intPart
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? '-' + grouped : grouped
}

// ── Display formatting ──

/** 2^256-1 — the conventional "no limit" sentinel for amount-like values. */
export const MAX_UINT256 = (1n << 256n) - 1n

export interface FormatAmountOptions {
  /** Resolved token identity, required to format `token-amount` with real decimals/symbol. */
  tokenInfo?: TokenInfo
  /** Cap fractional digits (rounded half-up). Default: exact (no cap). */
  maxDecimals?: number
  /** Append the unit symbol when one is known. Default: true. */
  symbol?: boolean
  /** Group the integer part with thousands separators. Default: true. */
  group?: boolean
  /**
   * Label rendered for a value of 2^256-1 (unlimited approvals), per the
   * standard's SHOULD. Pass `false` to format the sentinel as a number instead.
   * Default: "Unlimited".
   */
  unlimited?: string | false
}

/**
 * Format a raw base-unit integer as a human display string for an amount-like
 * semantic type — the canonical read-side renderer for `eth`, `gwei`, `amount`,
 * and `token-amount`.
 *
 * ```ts
 * formatAmount(1500000000000000000n, 'eth')                       // "1.5 ETH"
 * formatAmount(2500000000n, 'gwei')                               // "2.5 gwei"
 * formatAmount(123456789n, { type: 'amount', decimals: 6 }, { symbol: false }) // "123.456789"
 * formatAmount(1000000n, { type: 'token-amount', tokenAddress }, { tokenInfo: { decimals: 6, symbol: 'USDC' } }) // "1 USDC"
 * ```
 *
 * Returns `null` for non-amount types so callers can fall back to their default
 * rendering.
 */
export function formatAmount(
  raw: bigint | string | number,
  type: ParamType | undefined | null,
  options: FormatAmountOptions = {},
): string | null {
  const display = resolveAmountDisplay(type, options.tokenInfo)
  if (!display) return null

  const { symbol = true, group = true, maxDecimals, unlimited = 'Unlimited' } = options
  const value = toBigInt(raw)

  if (unlimited !== false && value === MAX_UINT256) {
    return symbol && display.symbol ? `${unlimited} ${display.symbol}` : unlimited
  }

  let text = toDecimalString(value, display.decimals, maxDecimals)

  if (group) {
    const [intPart, fracPart] = text.split('.')
    text = fracPart ? groupInteger(intPart) + '.' + fracPart : groupInteger(intPart)
  }

  return symbol && display.symbol ? `${text} ${display.symbol}` : text
}

/**
 * Parse a human decimal string into the raw base-unit integer for an amount-like
 * semantic type — the canonical write-side parser. Inverse of {@link formatAmount}.
 *
 * Throws if `type` is not amount-like or `value` is not a valid number.
 */
export function parseAmount(
  value: string,
  type: ParamType | undefined | null,
  tokenInfo?: TokenInfo,
): bigint {
  const display = resolveAmountDisplay(type, tokenInfo)
  if (!display) {
    throw new Error(
      'parseAmount: type is not amount-like, or the token identity is unresolved (pass tokenInfo for token-amount)',
    )
  }
  return parseUnits(value, display.decimals)
}

// ── Token resolution ──

/** Context for resolving which token a `token-amount` or `token-id` type refers to. */
export interface TokenResolutionContext {
  /** The contract the metadata document describes — the default for bare forms. */
  contractAddress?: string
  /**
   * Look up a decoded argument by the key written in the metadata (ABI name or
   * `_N` positional key) — needed to resolve `tokenParam` references.
   */
  getArg?: (key: string) => unknown
}

/** The explicit `tokenAddress` of a `token-amount` / `token-id` object type, if any. */
export function tokenAddressOf(type: ParamType | undefined | null): string | undefined {
  if (type && typeof type === 'object' && (type.type === 'token-amount' || type.type === 'token-id')) {
    return type.tokenAddress?.toLowerCase()
  }
  return undefined
}

/** The `tokenParam` reference of a `token-amount` object type, if any. */
export function tokenParamOf(type: ParamType | undefined | null): string | undefined {
  if (type && typeof type === 'object' && type.type === 'token-amount') {
    return type.tokenParam
  }
  return undefined
}

/**
 * Resolve the token contract a `token-amount` or `token-id` type refers to,
 * per the standard's resolution order: explicit `tokenAddress` → the value of
 * the `tokenParam` argument → the described contract (bare form).
 *
 * Returns the address lowercased, or `undefined` when the type is not
 * token-denominated or a `tokenParam` argument is missing / not an address.
 */
export function resolveTokenAddress(
  type: ParamType | undefined | null,
  context: TokenResolutionContext = {},
): string | undefined {
  if (!type) return undefined

  const name = typeof type === 'string' ? type : type.type
  if (name !== 'token-amount' && name !== 'token-id') return undefined

  const explicit = tokenAddressOf(type)
  if (explicit) return explicit

  const param = tokenParamOf(type)
  if (param) {
    const arg = context.getArg?.(param)
    return typeof arg === 'string' && /^0x[0-9a-fA-F]{40}$/.test(arg)
      ? arg.toLowerCase()
      : undefined
  }

  return context.contractAddress?.toLowerCase()
}
