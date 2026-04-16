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

function overloadSlug(fn: AbiFunction): string {
  const types = (fn.inputs ?? []).map(i => i.type).join('-')
  return types ? `${fn.name}-${types}` : fn.name
}

/**
 * Resolve the list of user-facing actions for a contract given its ABI and
 * merged metadata document.
 *
 * - Every ABI function yields a synthesized default action unless an authored
 *   action with the same canonical id resolves to the same selector.
 * - Authored actions referencing the ABI function by name, signature, or
 *   selector appear alongside defaults (as variants when their id differs).
 * - `issues` surfaces non-fatal problems: unresolved refs, ambiguous overloads,
 *   param flags missing autofill, and unknown `related` references.
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
  const authoredIdsBySelector = new Map<string, Set<string>>()

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
    const set = authoredIdsBySelector.get(sel) ?? new Set<string>()
    set.add(id)
    authoredIdsBySelector.set(sel, set)

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

  for (const fn of fns) {
    const sig = sigByFn.get(fn)!
    const sel = selByFn.get(fn)!
    const defaultId = (nameCount.get(fn.name) ?? 0) > 1 ? overloadSlug(fn) : fn.name
    const authoredForSelector = authoredIdsBySelector.get(sel)

    if (authoredForSelector?.has(defaultId)) continue

    emitted.push({
      id: defaultId,
      abi: fn,
      selector: sel,
      signature: sig,
      meta: { function: fn.name },
      synthesized: true,
      isVariant: false,
    })
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
    const params = action.meta.params ?? {}
    for (const [pKey, p] of Object.entries(params)) {
      if (!p) continue
      if (p.hidden && p.autofill === undefined) {
        issues.push({
          id: action.id,
          code: 'hidden-without-autofill',
          message: `action "${action.id}" param "${pKey}" is hidden but has no autofill`,
        })
      }
      if (p.disabled && p.autofill === undefined) {
        issues.push({
          id: action.id,
          code: 'disabled-without-autofill',
          message: `action "${action.id}" param "${pKey}" is disabled but has no autofill`,
        })
      }
      if (p.hidden && p.disabled) {
        issues.push({
          id: action.id,
          code: 'hidden-and-disabled',
          message: `action "${action.id}" param "${pKey}" sets both hidden and disabled — these are mutually exclusive`,
        })
      }
    }
  }

  const ids = new Set(emitted.map(a => a.id))
  for (const action of emitted) {
    for (const ref of action.meta.related ?? []) {
      if (!ids.has(ref)) {
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
