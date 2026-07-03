import { canonicalSignature, computeSelector } from '@1001-digital/proxies'
import type { ActionMeta, ContractMetadataDocument } from './types'

export interface AbiParam {
  name?: string
  type: string
  components?: AbiParam[]
}

export interface AbiFunction {
  type: 'function'
  name: string
  inputs: AbiParam[]
  outputs?: AbiParam[]
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable'
}

export interface ResolvedAction {
  /** Free-form action identifier (authored key or synthesized default id). */
  id: string
  /** The ABI function entry this action invokes. */
  abi: AbiFunction
  /** 4-byte selector, lowercase. Stable handle for calldata routing. */
  selector: `0x${string}`
  /** Canonical signature, e.g. "approve(address,uint256)". */
  signature: string
  /** The action metadata — authored or synthesized from the ABI. */
  meta: ActionMeta
  /** True when the action was synthesized from the ABI (no authored entry). */
  synthesized: boolean
  /** True when another action in the result shares this selector. */
  isVariant: boolean
}

export type ActionIssueCode =
  | 'unresolved-function'
  | 'ambiguous-overload'
  | 'hidden-without-autofill'
  | 'disabled-without-autofill'
  | 'unknown-related'
  | 'hidden-and-disabled'
  | 'value-on-nonpayable'

export interface ActionResolutionIssue {
  id: string
  code: ActionIssueCode
  message: string
}

export interface ActionResolutionResult {
  actions: ResolvedAction[]
  issues: ActionResolutionIssue[]
}

const SELECTOR_RE = /^0x[0-9a-f]{8}$/i
const SIGNATURE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*\(.*\)$/

function isAbiFunction(item: unknown): item is AbiFunction {
  if (typeof item !== 'object' || item === null) return false
  const entry = item as { type?: unknown; name?: unknown }
  return entry.type === 'function' && typeof entry.name === 'string'
}

function extractAbiFunctions(abi: readonly unknown[]): AbiFunction[] {
  const out: AbiFunction[] = []
  for (const entry of abi) {
    if (isAbiFunction(entry)) {
      out.push({
        ...entry,
        inputs: (entry.inputs ?? []) as AbiParam[],
      })
    }
  }
  return out
}

function synthesizeDefault(
  fn: AbiFunction,
  signature: string,
  selector: `0x${string}`,
  id: string,
): ResolvedAction {
  return {
    id,
    abi: fn,
    selector,
    signature,
    meta: { function: fn.name },
    synthesized: true,
    isVariant: false,
  }
}

/**
 * Resolve the list of user-facing actions for a contract given its ABI and
 * merged metadata document.
 *
 * - Each ABI function that no authored action references yields a synthesized
 *   default action. Once any authored action references a function, no default
 *   is synthesized for it — the authored actions are its complete
 *   representation. Authors who want a plain generic form alongside curated
 *   variants author a base action; authors who want a function fully
 *   suppressed author a single action for it with `hidden: true`.
 * - Synthesized defaults use the function name as id (canonical signature for
 *   overloads). They are consumer-internal — authored `related` references
 *   must point at authored actions only.
 * - `issues` surfaces non-fatal problems: unresolved refs, ambiguous overloads,
 *   param/value flags missing autofill, `value` on non-payable functions, and
 *   unknown `related` references.
 */
export function resolveActions(
  abi: readonly unknown[],
  doc: Partial<ContractMetadataDocument>,
): ActionResolutionResult {
  const fns = extractAbiFunctions(abi)
  const byName = new Map<string, AbiFunction[]>()
  const bySignature = new Map<string, AbiFunction>()
  const bySelector = new Map<string, AbiFunction>()
  const sigByFn = new Map<AbiFunction, string>()
  const selByFn = new Map<AbiFunction, `0x${string}`>()

  for (const fn of fns) {
    const sig = canonicalSignature(fn)
    const sel = computeSelector(sig).toLowerCase() as `0x${string}`
    sigByFn.set(fn, sig)
    selByFn.set(fn, sel)
    bySignature.set(sig, fn)
    bySelector.set(sel, fn)
    const list = byName.get(fn.name) ?? []
    list.push(fn)
    byName.set(fn.name, list)
  }

  const issues: ActionResolutionIssue[] = []
  const emitted: ResolvedAction[] = []
  const authoredSelectors = new Set<string>()

  const authored = doc.actions ?? {}

  for (const [id, meta] of Object.entries(authored)) {
    // When `function` is omitted, fall back to the action id — so the common
    // 1:1 case (`"approve": { title: "..." }`) needs no explicit reference.
    const ref = meta.function ?? id
    let target: AbiFunction | undefined

    if (SELECTOR_RE.test(ref)) {
      target = bySelector.get(ref.toLowerCase())
    } else if (SIGNATURE_RE.test(ref)) {
      target = bySignature.get(ref)
    } else {
      const matches = byName.get(ref) ?? []
      if (matches.length === 1) {
        target = matches[0]
      } else if (matches.length > 1) {
        issues.push({
          id,
          code: 'ambiguous-overload',
          message: `action "${id}" references overloaded function "${ref}" — use a canonical signature (e.g. "${canonicalSignature(matches[0]!)}")`,
        })
        continue
      }
    }

    if (!target) {
      issues.push({
        id,
        code: 'unresolved-function',
        message: `action "${id}" references function "${ref}" which does not exist in the ABI`,
      })
      continue
    }

    const sig = sigByFn.get(target)!
    const sel = selByFn.get(target)!
    authoredSelectors.add(sel)

    emitted.push({
      id,
      abi: target,
      selector: sel,
      signature: sig,
      meta,
      synthesized: false,
      isVariant: false,
    })
  }

  const nameCount = new Map<string, number>()
  for (const fn of fns) {
    nameCount.set(fn.name, (nameCount.get(fn.name) ?? 0) + 1)
  }

  // Any authored action referencing a function suppresses its synthesized
  // default — even a hidden one (that is how authors suppress a function).
  for (const fn of fns) {
    const sig = sigByFn.get(fn)!
    const sel = selByFn.get(fn)!
    if (authoredSelectors.has(sel)) continue
    const defaultId = (nameCount.get(fn.name) ?? 0) > 1 ? sig : fn.name
    emitted.push(synthesizeDefault(fn, sig, sel, defaultId))
  }

  const bySelGroup = new Map<string, ResolvedAction[]>()
  for (const action of emitted) {
    const list = bySelGroup.get(action.selector) ?? []
    list.push(action)
    bySelGroup.set(action.selector, list)
  }
  for (const list of bySelGroup.values()) {
    if (list.length > 1) {
      for (const a of list) a.isVariant = true
    }
  }

  for (const action of emitted) {
    if (action.synthesized) continue
    for (const [pKey, p] of Object.entries(action.meta.params ?? {})) {
      if (!p) continue
      issues.push(...lockFlagIssues(p, action.id, `param "${pKey}"`))
    }
    if (action.meta.value) {
      issues.push(...lockFlagIssues(action.meta.value, action.id, 'value'))
      const mutability = action.meta.stateMutability ?? action.abi.stateMutability
      if (mutability !== undefined && mutability !== 'payable') {
        issues.push({
          id: action.id,
          code: 'value-on-nonpayable',
          message: `action "${action.id}" declares value metadata but "${action.signature}" is ${mutability}`,
        })
      }
    }
  }

  // Synthesized defaults are consumer-internal — authored cross-references
  // must resolve against authored action ids only.
  const authoredIds = new Set(Object.keys(authored))
  for (const action of emitted) {
    if (action.synthesized) continue
    for (const ref of action.meta.related ?? []) {
      if (!authoredIds.has(ref)) {
        issues.push({
          id: action.id,
          code: 'unknown-related',
          message: `action "${action.id}" references unknown related action "${ref}"`,
        })
      }
    }
  }

  return { actions: emitted, issues }
}

function lockFlagIssues(
  p: { autofill?: unknown; hidden?: boolean; disabled?: boolean },
  id: string,
  what: string,
): ActionResolutionIssue[] {
  const issues: ActionResolutionIssue[] = []
  if (p.hidden && p.autofill === undefined) {
    issues.push({
      id,
      code: 'hidden-without-autofill',
      message: `action "${id}" ${what} is hidden but has no autofill`,
    })
  }
  if (p.disabled && p.autofill === undefined) {
    issues.push({
      id,
      code: 'disabled-without-autofill',
      message: `action "${id}" ${what} is disabled but has no autofill`,
    })
  }
  if (p.hidden && p.disabled) {
    issues.push({
      id,
      code: 'hidden-and-disabled',
      message: `action "${id}" ${what} sets both hidden and disabled — these are mutually exclusive`,
    })
  }
  return issues
}

// ── Parameter keys ──

const POSITIONAL_KEY_RE = /^_(\d+)$/

/**
 * Metadata entry for the ABI parameter at `index`. The name key wins over the
 * positional `_N` key (zero-based), which keeps interface metadata portable
 * across implementations that name the same parameter differently.
 */
export function paramMetaAt<T>(
  params: Record<string, T> | undefined,
  param: { name?: string } | undefined,
  index: number,
): T | undefined {
  if (!params) return undefined
  const name = param?.name
  if (name && params[name] !== undefined) return params[name]
  return params[`_${index}`]
}

/**
 * True when a locked (hidden/disabled) parameter or `value` autofills from
 * `connected-address` — the action is unusable without a connected wallet.
 */
export function actionRequiresSender(meta: ActionMeta): boolean {
  const locked = (p?: {
    autofill?: unknown
    hidden?: boolean
    disabled?: boolean
  }) =>
    Boolean(p && (p.hidden || p.disabled) && p.autofill === 'connected-address')

  return Object.values(meta.params ?? {}).some(locked) || locked(meta.value)
}

// ── Calldata → action matching ──

/**
 * A decoded contract call, as produced by the consumer's own ABI decoder.
 * Matching operates on decoded arguments — the SDK does not decode calldata.
 */
export interface DecodedCall {
  /** 4-byte selector of the calldata, e.g. "0xa9059cbb". */
  selector: string
  /** Decoded argument values, keyed by ABI parameter name. */
  args?: Record<string, unknown>
  /** Native currency attached to the call, in wei. */
  value?: bigint | number | string
  /** Transaction sender — enables `connected-address` constraints. */
  sender?: string
  /** Address of the described contract — enables `contract-address` constraints. */
  contract?: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// The value a locked param's autofill must equal at matching time, or null
// when it is not knowable (block-timestamp, missing context) and therefore
// contributes no constraint.
function resolveAutofill(autofill: unknown, call: DecodedCall): string | null {
  if (typeof autofill === 'string') {
    switch (autofill) {
      case 'zero-address': return ZERO_ADDRESS
      case 'contract-address': return call.contract ?? null
      case 'connected-address': return call.sender ?? null
      // Not knowable at matching time — MUST NOT be used as a constraint.
      case 'block-timestamp': return null
      default: return null
    }
  }
  if (autofill && typeof autofill === 'object' && (autofill as { type?: string }).type === 'constant') {
    const value = (autofill as { value?: string }).value
    return value === undefined ? null : value
  }
  return null
}

function toBigInt(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v)
  if (typeof v === 'boolean') return v ? 1n : 0n
  if (typeof v === 'string') {
    try { return BigInt(v) } catch { return null }
  }
  return null
}

// Numeric equality when both sides parse as integers (covers hex vs decimal
// and address zero-padding); case-insensitive string equality otherwise.
function valuesEqual(actual: unknown, expected: string): boolean {
  const a = toBigInt(actual)
  const e = toBigInt(expected)
  if (a !== null && e !== null) return a === e
  return String(actual).toLowerCase() === expected.toLowerCase()
}

interface Candidate {
  action: ResolvedAction
  locked: number
  failed: boolean
}

// Decoded argument for the ABI parameter at `index` — by name, then `_N`,
// then bare index (some decoders key unnamed params that way).
function decodedArgAt(
  call: DecodedCall,
  param: AbiParam | undefined,
  index: number,
): unknown {
  const args = call.args
  if (!args) return undefined
  const name = param?.name
  if (name && name in args) return args[name]
  if (`_${index}` in args) return args[`_${index}`]
  return args[String(index)]
}

function evaluateCandidate(action: ResolvedAction, call: DecodedCall): Candidate {
  const candidate: Candidate = { action, locked: 0, failed: false }

  const applyConstraint = (
    p: { autofill?: unknown; hidden?: boolean; disabled?: boolean },
    actual: unknown,
  ) => {
    if (!p.hidden && !p.disabled) return
    const expected = resolveAutofill(p.autofill, call)
    if (expected === null) return
    // A locked param whose decoded argument is unavailable cannot be
    // confirmed — treat as failed so an unverified variant never wins
    // over the base action.
    if (actual === undefined || !valuesEqual(actual, expected)) {
      candidate.failed = true
      return
    }
    candidate.locked++
  }

  // Walk ABI inputs by position so `_N` keys constrain the right argument.
  const inputs = action.abi.inputs ?? []
  for (const [i, input] of inputs.entries()) {
    const p = paramMetaAt(action.meta.params, input, i)
    if (!p) continue
    applyConstraint(p, decodedArgAt(call, input, i))
    if (candidate.failed) return candidate
  }

  // Locked keys that resolve to no ABI parameter can never be confirmed.
  const resolvable = new Set<string>()
  inputs.forEach((input, i) => {
    if (input.name) resolvable.add(input.name)
    resolvable.add(`_${i}`)
  })
  for (const [key, p] of Object.entries(action.meta.params ?? {})) {
    if (!p || resolvable.has(key)) continue
    applyConstraint(p, undefined)
    if (candidate.failed) return candidate
  }

  if (action.meta.value) {
    applyConstraint(action.meta.value, call.value)
  }
  return candidate
}

/**
 * Resolve a decoded call to the most specific action, per the spec's
 * calldata-matching algorithm:
 *
 * 1. Actions whose selector matches are candidates (including hidden ones —
 *    they are still the best description of a historical transaction).
 * 2. Every locked parameter (hidden/disabled with an autofill knowable at
 *    matching time) is an equality constraint against the decoded argument;
 *    a locked `value` constrains the transaction value the same way.
 * 3. Candidates with a failed constraint are discarded. Of the remainder, the
 *    one with the most locked parameters wins; ties break by lowest `order`,
 *    then lexicographically smallest id — deterministic across consumers.
 * 4. If every candidate fails, an ABI-synthesized default for the function is
 *    returned. Returns null only when no action matches the selector at all.
 *
 * Matching selects a *presentation*, not a security guarantee — consumers
 * should still surface the underlying function signature.
 */
export function matchAction(
  actions: readonly ResolvedAction[],
  call: DecodedCall,
): ResolvedAction | null {
  const selector = call.selector.toLowerCase()
  const candidates = actions
    .filter(a => a.selector === selector)
    .map(a => evaluateCandidate(a, call))

  if (candidates.length === 0) return null

  const surviving = candidates.filter(c => !c.failed)
  if (surviving.length === 0) {
    const { abi, signature, selector: sel } = candidates[0]!.action
    return synthesizeDefault(abi, signature, sel, abi.name)
  }

  surviving.sort((a, b) =>
    b.locked - a.locked
    || (a.action.meta.order ?? Infinity) - (b.action.meta.order ?? Infinity)
    || (a.action.id < b.action.id ? -1 : a.action.id > b.action.id ? 1 : 0),
  )
  return surviving[0]!.action
}
