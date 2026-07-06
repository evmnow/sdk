import {
  buildCompositeAbi,
  canonicalSignature,
  computeSelector,
  detectProxy,
  filterAbiBySelectors,
} from '@1001-digital/proxies'
import type { RawProxy, ResolvedTarget } from '@1001-digital/proxies'
import { isRecord, merge } from '../merge'
import { mergeNatspecDocs } from '../natspec'
import { buildSourcifyLayer, fetchSourcify } from './sourcify'
import type {
  AbiItem,
  ContractMetadataDocument,
  NatSpec,
  ProxyResolution,
  SourcifyResult,
  TargetInfo,
} from '../types'

// Re-export the proxy primitives so SDK consumers keep a single import surface.
export {
  detectProxy,
  detectDiamond,
  detectEip1967,
  detectEip1967Beacon,
  detectEip1822,
  detectZeppelinOs,
  detectEip1167,
  detectGnosisSafe,
  detectEip897,
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  DIAMOND_LOUPE_INTERFACE_ID,
  SUPPORTS_INTERFACE_SELECTOR,
  FACETS_SELECTOR,
  IMPLEMENTATION_SELECTOR,
  EIP1967_IMPL_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_ADMIN_SLOT,
  EIP1822_PROXIABLE_SLOT,
  ZEPPELINOS_IMPL_SLOT,
  ZEPPELINOS_ADMIN_SLOT,
} from '@1001-digital/proxies'
export type { ProxyPattern, RawProxy, ResolvedTarget } from '@1001-digital/proxies'

// NatSpec merging is an SDK-local concern (Solidity-specific format, not proxy
// domain) — exposed alongside the proxy primitives for callers composing their
// own multi-target results.
export { mergeNatspecDocs } from '../natspec'

/**
 * Enrich resolved targets with Sourcify results. Returns both the canonical
 * `TargetInfo[]` (with NatSpec attached) and the raw `SourcifyResult[]` so
 * callers can derive their own layers (e.g. {@link composeProxyResolution}).
 *
 * Pass `null` for `sourcifyFetch` to skip Sourcify entirely — targets will
 * carry only `address` + (optional) `selectors`.
 *
 * For diamond facets (`target.selectors` defined), the ABI is filtered to
 * those selectors. For single-impl proxies, the full implementation ABI is
 * passed through untouched.
 */
export async function enrichTargets(
  rawTargets: ResolvedTarget[],
  sourcifyFetch: ((address: string) => Promise<SourcifyResult | null>) | null,
): Promise<{ targets: TargetInfo[]; sourcifyResults: (SourcifyResult | null)[] }> {
  const rawResults: (SourcifyResult | null)[] = sourcifyFetch
    ? await Promise.all(
        rawTargets.map(t => sourcifyFetch(t.address).catch(() => null)),
      )
    : rawTargets.map(() => null)

  // Diamond facets are mounted per selector — restrict everything derived
  // from the facet (ABI, NatSpec methods, actions) to the mounted selectors
  // so an unmounted facet function can't inject actions into the result.
  const sourcifyResults = rawResults.map((src, i) => {
    const selectors = rawTargets[i]!.selectors
    return src && selectors !== undefined
      ? filterSourcifyBySelectors(src, selectors)
      : src
  })

  const targets: TargetInfo[] = rawTargets.map((t, i) => {
    const src = sourcifyResults[i]
    const info: TargetInfo = { address: t.address }
    if (t.selectors !== undefined) info.selectors = t.selectors
    if (src?.abi) info.abi = src.abi
    if (src?.userdoc || src?.devdoc) {
      info.natspec = { userdoc: src.userdoc, devdoc: src.devdoc }
    }
    if (src?.sources) {
      info.sources = src.sources
    }
    return info
  })

  return { targets, sourcifyResults }
}

/**
 * Restrict a facet's SourcifyResult to the selectors mounted on the diamond:
 * the ABI is filtered via {@link filterAbiBySelectors}, NatSpec `methods`
 * entries (keyed by canonical signature) and derived `actions` are kept only
 * when their selector is mounted. Events and errors pass through — they are
 * not selector-addressable.
 */
export function filterSourcifyBySelectors(
  src: SourcifyResult,
  selectors: string[],
): SourcifyResult {
  const mounted = new Set(selectors.map(s => s.toLowerCase()))
  const isMountedSignature = (sig: string) =>
    mounted.has(computeSelector(sig).toLowerCase())

  // Collect every full signature we can see (ABI + NatSpec method keys) to
  // resolve bare-name action references to mounted function names.
  const signatures = new Set<string>()
  if (src.abi) {
    for (const entry of src.abi) {
      if (isRecord(entry) && entry.type === 'function' && typeof entry.name === 'string') {
        signatures.add(canonicalSignature(entry as Parameters<typeof canonicalSignature>[0]))
      }
    }
  }
  for (const doc of [src.userdoc, src.devdoc]) {
    if (isRecord(doc) && isRecord(doc.methods)) {
      for (const key of Object.keys(doc.methods)) {
        if (key.includes('(')) signatures.add(key)
      }
    }
  }
  const mountedNames = new Set<string>()
  for (const sig of signatures) {
    if (isMountedSignature(sig)) mountedNames.add(sig.slice(0, sig.indexOf('(')))
  }

  const out: SourcifyResult = { ...src }

  if (src.abi) out.abi = filterAbiBySelectors(src.abi, selectors) as AbiItem[]

  if (src.userdoc) out.userdoc = filterNatspecDoc(src.userdoc, isMountedSignature)
  if (src.devdoc) out.devdoc = filterNatspecDoc(src.devdoc, isMountedSignature)

  if (src.actions) {
    const actions: NonNullable<SourcifyResult['actions']> = {}
    for (const [key, meta] of Object.entries(src.actions)) {
      const ref = meta.function ?? key
      const keep = ref.includes('(')
        ? isMountedSignature(ref)
        : mountedNames.has(ref)
      if (keep) actions[key] = meta
    }
    if (Object.keys(actions).length > 0) out.actions = actions
    else delete out.actions
  }

  return out
}

function filterNatspecDoc(
  doc: Record<string, unknown>,
  isMountedSignature: (sig: string) => boolean,
): Record<string, unknown> {
  if (!isRecord(doc.methods)) return doc
  const methods: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc.methods)) {
    if (key.includes('(') && isMountedSignature(key)) methods[key] = value
  }
  return { ...doc, methods }
}

/**
 * Build the derived outputs (composite ABI, metadata layer, merged NatSpec)
 * from enriched targets. Pure; no I/O.
 */
export function composeProxyResolution(
  targets: TargetInfo[],
  sourcifyResults: (SourcifyResult | null)[],
): Omit<ProxyResolution, 'pattern' | 'targets' | 'beacon' | 'admin'> {
  const out: Omit<ProxyResolution, 'pattern' | 'targets' | 'beacon' | 'admin'> = {}

  const abiLayers = targets
    .map(t => t.abi)
    .filter((a): a is AbiItem[] => a !== undefined)
  if (abiLayers.length > 0) {
    out.compositeAbi = buildCompositeAbi(abiLayers) as AbiItem[]
  }

  // `merge` gives the LAST layer the highest priority; reverse so the first
  // target wins — consistent with the first-target-wins NatSpec merge below.
  const layers = sourcifyResults
    .map(src => src && buildSourcifyLayer(src))
    .filter((l): l is Partial<ContractMetadataDocument> => !!l)
  if (layers.length > 0) {
    out.metadataLayer = merge(...layers.reverse())
  }

  const userdoc = mergeNatspecDocs(...targets.map(t => t.natspec?.userdoc))
  const devdoc = mergeNatspecDocs(...targets.map(t => t.natspec?.devdoc))
  if (userdoc || devdoc) {
    const natspec: NatSpec = {}
    if (userdoc) natspec.userdoc = userdoc
    if (devdoc) natspec.devdoc = devdoc
    out.natspec = natspec
  }

  return out
}

/**
 * High-level: detect any supported proxy pattern, enrich with Sourcify, and
 * compose the result. Returns `null` when the contract is not a proxy.
 *
 * Sourcify enrichment can be disabled via `options.sourcify: false` — the
 * returned targets will then only carry `address` (and `selectors` for
 * diamond facets).
 */
export async function fetchProxy(
  rpc: string,
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  options: { sourcify?: boolean; sourcifyUrl?: string; sources?: boolean } = {},
): Promise<ProxyResolution | null> {
  const raw: RawProxy | null = await detectProxy(rpc, address, fetchFn)
  if (!raw) return null

  const sourcifyEnabled = options.sourcify !== false
  const sourcifyFetch = sourcifyEnabled
    ? (a: string) =>
        fetchSourcify(
          chainId,
          a,
          fetchFn,
          options.sourcifyUrl,
          options.sources ? ['sources'] : undefined,
        )
    : null

  const { targets, sourcifyResults } = await enrichTargets(raw.targets, sourcifyFetch)
  const derived = composeProxyResolution(targets, sourcifyResults)

  const resolution: ProxyResolution = { pattern: raw.pattern, targets, ...derived }
  if (raw.beacon) resolution.beacon = raw.beacon
  if (raw.admin) resolution.admin = raw.admin
  return resolution
}
