import type { ActionMeta, ParamMeta, ValueMeta } from './types'

// ── Document semantic validation ──
//
// Checks a metadata document for problems the JSON Schema cannot express:
// cross-references (groups, related actions), input-flag contracts
// (hidden/disabled require autofill), key formats, and variant ambiguity
// (two actions on one function with identical locked parameters cannot be
// distinguished by calldata matching). This is the canonical implementation —
// the standard repo's validate script and other tooling consume it, so the
// rules stay in one place next to the matching logic they mirror.
//
// Pure and filesystem-free: existence checks that need I/O (does an included
// interface file exist?) are injected via options.

// Key formats per the spec's "Action, Event, and Error Keys".
const SELECTOR_4BYTE = /^0x[0-9a-f]{8}$/
const TOPIC_32BYTE = /^0x[0-9a-f]{64}$/
const SIGNATURE_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*\(.*\)$/
const BARE_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
const ACTION_ID_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

export interface SemanticIssue {
  /** Dot path anchoring the issue, e.g. "actions.revoke.related". */
  path: string
  /** Full human-readable description of the problem. */
  message: string
}

/**
 * The document shape the semantic checks operate on — satisfied by both
 * contract metadata documents and interface files.
 */
export interface ValidatableDocument {
  address?: string
  includes?: string[]
  groups?: Record<string, unknown>
  actions?: Record<string, ActionMeta>
  events?: Record<string, unknown>
  errors?: Record<string, unknown>
}

export interface SemanticCheckOptions {
  /**
   * The address the document is expected to describe (e.g. derived from its
   * filename). A mismatch with `doc.address` is reported.
   */
  expectedAddress?: string
  /**
   * Whether a named `interface:` include (e.g. "erc20") exists. When omitted,
   * includes are not checked.
   */
  interfaceExists?: (name: string) => boolean
}

/**
 * Run all semantic checks on a metadata document. Returns an empty array for
 * a clean document. Issues are advisory — they flag constructs that consumers
 * cannot interpret (unknown references) or that behave surprisingly
 * (indistinguishable variants), not schema violations.
 */
export function semanticChecks(
  doc: ValidatableDocument,
  options: SemanticCheckOptions = {},
): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  const groups = doc.groups ? Object.keys(doc.groups) : []

  if (doc.actions) {
    const actionIds = new Set(Object.keys(doc.actions))
    for (const [id, action] of Object.entries(doc.actions)) {
      const at = `actions.${id}`

      if (!ACTION_ID_RE.test(id)) {
        issues.push({
          path: at,
          message: `actions key "${id}" is not a valid action id (must match ${ACTION_ID_RE})`,
        })
      }

      if (action.function !== undefined) {
        if (!isValidFunctionRef(action.function)) {
          issues.push({
            path: `${at}.function`,
            message: `${at}.function "${action.function}" is not a valid name, signature, or 4-byte selector`,
          })
        }
      } else if (!BARE_NAME_RE.test(id)) {
        // No explicit `function` — the id is the fallback reference, so it must
        // itself be a valid bare function name (variants with hyphens etc.
        // need an explicit `function`).
        issues.push({
          path: at,
          message: `${at}: no "function" set, and id "${id}" is not a valid bare function name — set \`function\` explicitly`,
        })
      }

      if (action.group && groups.length > 0 && !groups.includes(action.group)) {
        issues.push({
          path: `${at}.group`,
          message: `${at}.group "${action.group}" not found in groups`,
        })
      }

      if (action.related) {
        for (const ref of action.related) {
          if (!actionIds.has(ref)) {
            issues.push({
              path: `${at}.related`,
              message: `${at}.related references unknown action "${ref}"`,
            })
          }
        }
      }

      if (action.params) {
        for (const [pKey, p] of Object.entries(action.params)) {
          issues.push(...paramIssues(p, `${at}.params.${pKey}`))
        }
      }

      if (action.value) {
        issues.push(...inputFlagIssues(action.value, `${at}.value`))
      }
    }

    issues.push(...ambiguityIssues(doc.actions))
  }

  for (const [section, table] of [
    ['events', doc.events],
    ['errors', doc.errors],
  ] as const) {
    if (!table) continue
    const selector = section === 'events' ? TOPIC_32BYTE : SELECTOR_4BYTE
    const selectorLabel = section === 'events' ? '32-byte topic hash' : '4-byte selector'
    for (const key of Object.keys(table)) {
      // A key that looks like hex must be EXACTLY the section's selector
      // format (lowercase, full length) — truncated hashes and uppercase hex
      // silently match nothing at runtime, so they are flagged here.
      const valid = key.toLowerCase().startsWith('0x')
        ? selector.test(key)
        : SIGNATURE_RE.test(key) || BARE_NAME_RE.test(key)
      if (!valid) {
        issues.push({
          path: `${section}.${key}`,
          message: `${section} key "${key}" is not a valid name, signature, or ${selectorLabel}`,
        })
      }
    }
  }

  if (doc.includes && options.interfaceExists) {
    for (const ref of doc.includes) {
      if (ref.startsWith('interface:')) {
        const name = ref.slice('interface:'.length)
        if (!options.interfaceExists(name)) {
          issues.push({
            path: 'includes',
            message: `includes references unknown interface "${ref}"`,
          })
        }
      }
    }
  }

  if (doc.address && options.expectedAddress && doc.address !== options.expectedAddress) {
    issues.push({
      path: 'address',
      message: `address "${doc.address}" does not match expected "${options.expectedAddress}"`,
    })
  }

  return issues
}

/** Whether a function reference is a bare name, full signature, or 4-byte selector. */
export function isValidFunctionRef(ref: string): boolean {
  return SELECTOR_4BYTE.test(ref) || SIGNATURE_RE.test(ref) || BARE_NAME_RE.test(ref)
}

function paramIssues(p: ParamMeta, where: string): SemanticIssue[] {
  const issues = inputFlagIssues(p, where)
  const type = p.type
  if (
    type &&
    typeof type === 'object' &&
    type.type === 'token-amount' &&
    type.tokenAddress !== undefined &&
    type.tokenParam !== undefined
  ) {
    issues.push({
      path: `${where}.type`,
      message: `${where}.type sets both tokenAddress and tokenParam — they are mutually exclusive`,
    })
  }
  return issues
}

function inputFlagIssues(p: ParamMeta | ValueMeta, where: string): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  if (p.hidden && p.autofill === undefined) {
    issues.push({ path: where, message: `${where}.hidden requires autofill` })
  }
  if (p.disabled && p.autofill === undefined) {
    issues.push({ path: where, message: `${where}.disabled requires autofill` })
  }
  if (p.hidden && p.disabled) {
    issues.push({
      path: where,
      message: `${where}.hidden and .disabled are mutually exclusive`,
    })
  }
  return issues
}

// The symbolic constraint a locked (hidden/disabled) param contributes to
// calldata matching, or null if the autofill can't be matched against
// (block-timestamp) or the param isn't locked.
function lockedConstraint(p: ParamMeta | ValueMeta): string | null {
  if (!p.hidden && !p.disabled) return null
  const a = p.autofill
  if (typeof a === 'string') {
    return a === 'block-timestamp' ? null : a
  }
  if (a && typeof a === 'object' && a.type === 'constant') {
    return `constant:${a.value}`
  }
  return null
}

// Two actions on the same function with identical locked constraints can't be
// told apart when matching decoded calldata — flag them.
function ambiguityIssues(actions: Record<string, ActionMeta>): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  const seen = new Map<string, string>()
  for (const [id, action] of Object.entries(actions)) {
    const fn = action.function ?? id
    const locks = Object.entries(action.params ?? {})
      .map(([pKey, p]) => [pKey, lockedConstraint(p)] as const)
      .filter(([, c]) => c !== null)
      .map(([pKey, c]) => `${pKey}=${c}`)
      .sort()
    if (action.value) {
      const c = lockedConstraint(action.value)
      if (c !== null) locks.push(`msg.value=${c}`)
    }
    const key = `${fn}|${locks.join(',')}`
    const prior = seen.get(key)
    if (prior !== undefined) {
      issues.push({
        path: `actions.${id}`,
        message: `actions.${id} and actions.${prior} target "${fn}" with identical locked parameters — calldata matching cannot distinguish them`,
      })
    } else {
      seen.set(key, id)
    }
  }
  return issues
}
