import type { ParamMeta, ParamType } from './types'
import {
  amountKind,
  formatAmount,
  resolveTokenAddress,
  type TokenInfo,
} from './format'

// ── Intent template rendering ──
//
// The standard's `intent` field is a sentence template rendered with formatted
// parameter values: "Transfer {value} from {from} to {to}". Placeholders are
// `{paramName}` (`{_N}` resolves positionally via the caller's `paramType` /
// `args` keying); a leading `#` prepends a hash symbol; `{value}` refers to the
// transaction value when no ABI parameter shadows the name. Values MUST be
// formatted by their semantic type before insertion — amount-like types route
// through `formatAmount` (including bare-token-amount → described-contract and
// `tokenParam` resolution); other types fall back to plain stringification,
// which callers can refine via their own display layer.

export interface IntentContext {
  /** Decoded argument values, keyed as the template references them (ABI name or `_N`). */
  args: Record<string, unknown>
  /** Native currency attached to the call, in wei — for the `{value}` placeholder. */
  value?: bigint | string | number | null
  /** The described contract — the default token for bare `token-amount` params. */
  contractAddress?: string
  /** Resolved token identities, looked up by lowercase token address. */
  resolveToken?: (address: string) => TokenInfo | undefined
  /**
   * Resolve the semantic type for a placeholder key. Positional (`_N`) aware —
   * build it from `paramMetaAt` so interface metadata applies. Falls back to a
   * plain name lookup in `meta.params` when omitted.
   */
  paramType?: (key: string) => ParamType | undefined
}

/** The `intent`-bearing shape of an action or EIP-712 message. */
export interface IntentMeta {
  intent?: string
  params?: Record<string, ParamMeta>
}

/**
 * Render an `intent` template with formatted argument values. Returns `null`
 * when the metadata has no intent template. Unknown placeholders are left
 * verbatim so authoring mistakes stay visible.
 */
export function renderIntent(
  meta: IntentMeta | undefined,
  ctx: IntentContext,
): string | null {
  const template = meta?.intent
  if (!template) return null

  return template.replace(
    /(#?)\{([\w$]+)\}/g,
    (_match, hash: string, name: string) => {
      // `{value}` → msg.value, unless an ABI param shadows the name.
      if (name === 'value' && !(name in ctx.args)) {
        const formatted =
          ctx.value == null ? null : formatAmount(ctx.value, 'eth')
        return hash + (formatted ?? String(ctx.value ?? ''))
      }

      const raw = ctx.args[name]
      if (raw === undefined) return hash + `{${name}}`

      const type = ctx.paramType?.(name) ?? meta?.params?.[name]?.type

      if (amountKind(type) && isNumberish(raw)) {
        const tokenAddress = resolveTokenAddress(type, {
          contractAddress: ctx.contractAddress,
          getArg: (key) => ctx.args[key],
        })
        const tokenInfo = tokenAddress
          ? ctx.resolveToken?.(tokenAddress)
          : undefined
        // Unresolved token-amount → formatAmount returns null → raw fallback,
        // per the standard's no-guessing rule.
        const formatted = formatAmount(raw, type, { tokenInfo })
        if (formatted !== null) return hash + formatted
      }

      return hash + defaultFormat(raw)
    },
  )
}

function isNumberish(value: unknown): value is bigint | number | string {
  return (
    typeof value === 'bigint' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
}

function defaultFormat(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(defaultFormat).join(', ')}]`
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, entry) =>
        typeof entry === 'bigint' ? entry.toString() : entry,
      )
    } catch {
      return String(value)
    }
  }
  return String(value ?? '')
}
