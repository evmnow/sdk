import {
  buildCompositeAbi,
  detectAndFetchFacets,
  filterAbiBySelectors,
} from '@1001-digital/diamonds'
import type { RawFacet } from '@1001-digital/diamonds'
import { isRecord, merge } from '../merge'
import { buildSourcifyLayer, fetchSourcify } from './sourcify'
import type {
  ContractMetadataDocument,
  DiamondResolution,
  FacetInfo,
  NatSpec,
  SourcifyResult,
} from '../types'

// Re-export the ERC-2535 primitives so SDK consumers keep a single import surface.
export {
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  detectAndFetchFacets,
  DIAMOND_LOUPE_INTERFACE_ID,
  SUPPORTS_INTERFACE_SELECTOR,
  FACETS_SELECTOR,
} from '@1001-digital/diamonds'
export type { RawFacet } from '@1001-digital/diamonds'

/**
 * Enrich raw facets with Sourcify results. Returns both the canonical
 * `FacetInfo[]` (with NatSpec attached) and the raw `SourcifyResult[]` so
 * callers can derive their own layers (e.g. {@link composeDiamondResolution}).
 *
 * Pass `null` for `sourcifyFetch` to skip Sourcify entirely — facets will
 * carry only `address` + `selectors`.
 */
export async function enrichFacets(
  rawFacets: RawFacet[],
  sourcifyFetch: ((address: string) => Promise<SourcifyResult | null>) | null,
): Promise<{ facets: FacetInfo[]; sourcifyResults: (SourcifyResult | null)[] }> {
  const sourcifyResults: (SourcifyResult | null)[] = sourcifyFetch
    ? await Promise.all(
        rawFacets.map(rf => sourcifyFetch(rf.facetAddress).catch(() => null)),
      )
    : rawFacets.map(() => null)

  const facets: FacetInfo[] = rawFacets.map((rf, i) => {
    const src = sourcifyResults[i]
    const info: FacetInfo = {
      address: rf.facetAddress,
      selectors: rf.functionSelectors,
    }
    if (src?.abi) info.abi = filterAbiBySelectors(src.abi, rf.functionSelectors)
    if (src?.userdoc || src?.devdoc) {
      info.natspec = { userdoc: src.userdoc, devdoc: src.devdoc }
    }
    return info
  })

  return { facets, sourcifyResults }
}

/**
 * Build the derived outputs (composite ABI, metadata layer, merged NatSpec)
 * from enriched facets. Pure; no I/O.
 */
export function composeDiamondResolution(
  facets: FacetInfo[],
  sourcifyResults: (SourcifyResult | null)[],
): Omit<DiamondResolution, 'facets'> {
  const out: Omit<DiamondResolution, 'facets'> = {}

  const abiLayers = facets
    .map(f => f.abi)
    .filter((a): a is unknown[] => a !== undefined)
  if (abiLayers.length > 0) {
    out.compositeAbi = buildCompositeAbi(abiLayers)
  }

  const layers = sourcifyResults
    .map(src => src && buildSourcifyLayer(src))
    .filter((l): l is Partial<ContractMetadataDocument> => !!l)
  if (layers.length > 0) {
    out.metadataLayer = merge(...layers)
  }

  const userdoc = mergeNatspecDocs(...facets.map(f => f.natspec?.userdoc))
  const devdoc = mergeNatspecDocs(...facets.map(f => f.natspec?.devdoc))
  if (userdoc || devdoc) {
    const natspec: NatSpec = {}
    if (userdoc) natspec.userdoc = userdoc
    if (devdoc) natspec.devdoc = devdoc
    out.natspec = natspec
  }

  return out
}

/**
 * Shallow-merge NatSpec userdoc/devdoc objects across multiple facets.
 *
 * - Record sections (`methods`, `events`, `errors`, `stateVariables`) merge
 *   per key — first non-overwritten entry wins.
 * - Scalar fields (`title`, `author`, `notice`, `details`, …) take the first
 *   non-undefined value.
 *
 * First-wins priority means callers should pass the most authoritative doc
 * first (e.g. the main diamond's docs, then each facet).
 */
export function mergeNatspecDocs(
  ...docs: (Record<string, unknown> | undefined | null)[]
): Record<string, unknown> | undefined {
  const present = docs.filter(
    (d): d is Record<string, unknown> => d !== undefined && d !== null,
  )
  if (present.length === 0) return undefined

  const recordKeys = new Set(['methods', 'events', 'errors', 'stateVariables'])
  const merged: Record<string, unknown> = {}

  for (const doc of present) {
    for (const [key, value] of Object.entries(doc)) {
      if (value === undefined) continue
      if (recordKeys.has(key) && isRecord(value)) {
        const existing = isRecord(merged[key]) ? (merged[key] as Record<string, unknown>) : {}
        merged[key] = { ...value, ...existing }
      } else if (merged[key] === undefined) {
        merged[key] = value
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * High-level: detect, fetch facets, and enrich with Sourcify. Returns null
 * when the contract is not a diamond.
 *
 * Sourcify enrichment can be disabled via `options.sourcify: false` — the
 * returned facets will then only carry `address` and `selectors`.
 */
export async function fetchDiamond(
  rpc: string,
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  options: { sourcify?: boolean; sourcifyUrl?: string } = {},
): Promise<DiamondResolution | null> {
  const rawFacets = await detectAndFetchFacets(rpc, address, fetchFn)
  if (!rawFacets) return null

  const sourcifyEnabled = options.sourcify !== false
  const sourcifyFetch = sourcifyEnabled
    ? (a: string) => fetchSourcify(chainId, a, fetchFn, options.sourcifyUrl)
    : null

  const { facets, sourcifyResults } = await enrichFacets(rawFacets, sourcifyFetch)
  const derived = composeDiamondResolution(facets, sourcifyResults)

  return { facets, ...derived }
}
