import type {
  ContractClientConfig,
  ContractClient,
  ContractMetadataDocument,
  ContractResult,
  DiamondResolution,
  FetchDiamondOptions,
  GetOptions,
  IncludeFields,
  RawFacet,
  SourcifyResult,
  SourceConfig,
} from './types'
import { ContractMetadataNotFoundError } from './errors'
import { merge, resolveIncludes } from './merge'
import { resolveEns, getChainId } from './rpc'
import { fetchRepository as fetchRepo } from './sources/repository'
import { fetchContractURI as fetchUri } from './sources/contract-uri'
import { fetchSourcify as fetchSrc, buildSourcifyLayer } from './sources/sourcify'
import {
  buildCompositeAbi,
  composeDiamondResolution,
  detectAndFetchFacets,
  enrichFacets,
  fetchDiamond as fetchDiamondSource,
  mergeNatspecDocs,
} from './sources/diamond'

const DEFAULT_SCHEMA_BASE =
  'https://raw.githubusercontent.com/evmnow/contract-metadata/refs/heads/main/schema'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export function createContractClient(config: ContractClientConfig): ContractClient {
  const chainId = config.chainId
  const rpc = config.rpc
  // ENS lives on Ethereum mainnet. When the user's contract rpc is already
  // mainnet, reuse it; otherwise they must provide an explicit mainnet rpc.
  const ensRpc = config.ensRpc ?? (chainId === 1 ? rpc : undefined)
  const repositoryUrl = config.repositoryUrl?.replace(/\/$/, '')
  const sourcifyUrl = config.sourcifyUrl?.replace(/\/$/, '')
  const ipfsGateway = config.ipfsGateway?.replace(/\/$/, '')
  const fetchFn = config.fetch ?? globalThis.fetch
  const defaultSources = config.sources ?? {}
  const defaultInclude = config.include ?? {}

  // Lazy, memoized consistency check between config.chainId and the rpc's
  // eth_chainId. Runs once per client, before the first RPC-dependent call.
  let rpcCheck: Promise<void> | null = null
  function ensureRpcChainId(): Promise<void> {
    if (!rpc) return Promise.resolve()
    if (!rpcCheck) {
      rpcCheck = getChainId(rpc, fetchFn).then(actual => {
        if (actual !== chainId) {
          throw new Error(
            `RPC chainId mismatch: config.chainId=${chainId} but rpc returned ${actual}`,
          )
        }
      })
    }
    return rpcCheck
  }

  async function resolveAddress(addressOrEns: string): Promise<string> {
    if (ADDRESS_RE.test(addressOrEns)) {
      return addressOrEns.toLowerCase()
    }

    if (addressOrEns.endsWith('.eth')) {
      if (!ensRpc) {
        throw new Error(
          'ENS resolution requires a mainnet RPC — set `ensRpc`, or set `rpc` when chainId === 1',
        )
      }
      const resolved = await resolveEns(ensRpc, addressOrEns, fetchFn)
      return resolved.toLowerCase()
    }

    throw new Error(`Invalid address or ENS name: ${addressOrEns}`)
  }

  function effectiveSources(override?: SourceConfig): SourceConfig {
    return { ...defaultSources, ...override }
  }

  function isEnabled(sources: SourceConfig, key: keyof SourceConfig): boolean {
    return sources[key] !== false
  }

  async function get(
    addressOrEns: string,
    options?: GetOptions,
  ): Promise<ContractResult> {
    const address = await resolveAddress(addressOrEns)
    const sources = effectiveSources(options?.sources)
    const include: IncludeFields = { ...defaultInclude, ...options?.include }

    const extraFields: string[] = []
    if (include.sources) extraFields.push('sources')
    if (include.deployedBytecode) extraFields.push('deployedBytecode')

    const sourcifyEnabled = isEnabled(sources, 'sourcify')

    const repoPromise = isEnabled(sources, 'repository')
      ? fetchRepository(address).catch(() => null)
      : Promise.resolve(null)

    const uriPromise = isEnabled(sources, 'contractURI') && rpc
      ? fetchContractURI(address).catch(() => null)
      : Promise.resolve(null)

    const srcPromise: Promise<SourcifyResult | null> = sourcifyEnabled
      ? fetchSourcifyWithFields(address, extraFields).catch(() => null)
      : Promise.resolve(null)

    const diamondPromise: Promise<RawFacet[] | null> =
      isEnabled(sources, 'diamond') && rpc
        ? ensureRpcChainId()
            .then(() => detectAndFetchFacets(rpc, address, fetchFn))
            .catch(() => null)
        : Promise.resolve(null)

    const [repoRaw, uriResult, srcResult, rawFacets] = await Promise.all([
      repoPromise, uriPromise, srcPromise, diamondPromise,
    ])

    let repoResult = repoRaw
    if (repoResult?.includes) {
      repoResult = await resolveIncludes(repoResult, fetchFn, DEFAULT_SCHEMA_BASE)
    }

    const sourcifyLayer: Partial<ContractMetadataDocument> | null = srcResult
      ? buildSourcifyLayer(srcResult)
      : null

    // Merge: lowest priority first
    const merged = merge(sourcifyLayer, uriResult, repoResult)

    if (Object.keys(merged).length === 0 && !srcResult?.abi && !rawFacets) {
      throw new ContractMetadataNotFoundError(chainId, address)
    }

    const result: ContractResult = {
      chainId,
      address,
      metadata: { ...merged, chainId, address } as ContractMetadataDocument,
    }

    if (srcResult?.abi) result.abi = srcResult.abi
    if (srcResult?.userdoc || srcResult?.devdoc) {
      result.natspec = { userdoc: srcResult.userdoc, devdoc: srcResult.devdoc }
    }
    if (srcResult?.sources) result.sources = srcResult.sources
    if (srcResult?.deployedBytecode) result.deployedBytecode = srcResult.deployedBytecode

    if (rawFacets) {
      await expandDiamond(
        result, rawFacets, sourcifyEnabled, srcResult, sourcifyLayer, uriResult, repoResult,
      )
    }

    return result
  }

  async function expandDiamond(
    result: ContractResult,
    rawFacets: RawFacet[],
    sourcifyEnabled: boolean,
    srcResult: SourcifyResult | null,
    sourcifyLayer: Partial<ContractMetadataDocument> | null,
    uriResult: Partial<ContractMetadataDocument> | null,
    repoResult: Partial<ContractMetadataDocument> | null,
  ): Promise<void> {
    // Fetch Sourcify directly per facet (not through client.get) — this is
    // the structural recursion guard against facets that themselves look like
    // diamonds. Skipped entirely when Sourcify is disabled.
    const sourcifyFetch = sourcifyEnabled
      ? (a: string) => fetchSrc(chainId, a, fetchFn, sourcifyUrl)
      : null

    const { facets, sourcifyResults } = await enrichFacets(rawFacets, sourcifyFetch)
    const derived = composeDiamondResolution(facets, sourcifyResults)

    result.facets = facets

    // Composite ABI: main diamond first (it may legitimately mount Loupe + admin
    // functions itself), then each facet's filtered ABI. First-occurrence wins.
    // When the diamond itself isn't verified, reuse the facet-only composite.
    if (srcResult?.abi) {
      const layers: unknown[][] = [srcResult.abi]
      for (const f of facets) if (f.abi) layers.push(f.abi)
      result.abi = buildCompositeAbi(layers)
    } else if (derived.compositeAbi) {
      result.abi = derived.compositeAbi
    }

    // Re-merge metadata with facet natspec layer at lowest priority so curated
    // repo/contractURI/main-sourcify docs still win.
    if (derived.metadataLayer) {
      const rebuilt = merge(derived.metadataLayer, sourcifyLayer, uriResult, repoResult)
      result.metadata = {
        ...rebuilt, chainId, address: result.address,
      } as ContractMetadataDocument
    }

    // NatSpec: main diamond first (highest authority), then merged facet natspec.
    const userdocMerged = mergeNatspecDocs(srcResult?.userdoc, derived.natspec?.userdoc)
    const devdocMerged = mergeNatspecDocs(srcResult?.devdoc, derived.natspec?.devdoc)
    if (userdocMerged || devdocMerged) {
      result.natspec = { userdoc: userdocMerged, devdoc: devdocMerged }
    }
  }

  async function fetchRepository(
    address: string,
  ): Promise<Partial<ContractMetadataDocument> | null> {
    return fetchRepo(chainId, address, fetchFn, repositoryUrl)
  }

  async function fetchContractURI(
    address: string,
  ): Promise<Partial<ContractMetadataDocument> | null> {
    if (!rpc) return null
    await ensureRpcChainId()
    return fetchUri(chainId, address, rpc, fetchFn, ipfsGateway)
  }

  async function fetchSourcifyWithFields(
    address: string,
    extraFields?: string[],
  ): Promise<SourcifyResult | null> {
    return fetchSrc(chainId, address, fetchFn, sourcifyUrl, extraFields)
  }

  async function fetchSourcify(
    address: string,
  ): Promise<SourcifyResult | null> {
    return fetchSrc(chainId, address, fetchFn, sourcifyUrl, ['sources', 'deployedBytecode'])
  }

  async function fetchDiamond(
    address: string,
    options?: FetchDiamondOptions,
  ): Promise<DiamondResolution | null> {
    if (!rpc) return null
    await ensureRpcChainId()
    return fetchDiamondSource(rpc, chainId, address, fetchFn, {
      sourcifyUrl,
      sourcify: options?.sourcify,
    })
  }

  return { get, fetchRepository, fetchContractURI, fetchSourcify, fetchDiamond }
}

// ── Re-exports ──

// Pure merge utilities
export { merge, resolveIncludes } from './merge'

// Diamond utilities
export {
  fetchDiamond,
  detectAndFetchFacets,
  enrichFacets,
  composeDiamondResolution,
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  mergeNatspecDocs,
  DIAMOND_LOUPE_INTERFACE_ID,
  SUPPORTS_INTERFACE_SELECTOR,
  FACETS_SELECTOR,
} from './sources/diamond'

// Per-source fetchers
export { fetchRepository } from './sources/repository'
export { fetchContractURI } from './sources/contract-uri'
export { fetchSourcify, buildSourcifyLayer } from './sources/sourcify'

// URI + ENS + RPC primitives
export { resolveUri } from './uri'
export { namehash, dnsEncode } from './ens'
export {
  ethCall,
  getChainId,
  resolveEns,
  decodeAbiString,
  CONTRACT_URI_SELECTOR,
} from './rpc'

// Errors
export {
  ContractMetadataError,
  ContractMetadataFetchError,
  ContractMetadataNotFoundError,
  ENSResolutionError,
} from './errors'

// Types
export type {
  ContractMetadataDocument,
  ContractClientConfig,
  ContractClient,
  ContractResult,
  DiamondResolution,
  FacetInfo,
  FetchDiamondOptions,
  NatSpec,
  GetOptions,
  IncludeFields,
  RawFacet,
  SourceConfig,
  SourcifyResult,
  DocumentMeta,
  Theme,
  Link,
  AuditReference,
  Group,
  FunctionMeta,
  EventMeta,
  ErrorMeta,
  MessageMeta,
  ParamMeta,
  ParamType,
  Autofill,
  ValidationRule,
  ParamPreview,
  FunctionExample,
} from './types'
