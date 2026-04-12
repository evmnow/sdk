import type {
  ContractClientConfig,
  ContractClient,
  ContractMetadataDocument,
  ContractResult,
  FacetInfo,
  GetOptions,
  IncludeFields,
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
  detectAndFetchFacets,
  filterAbiBySelectors,
  buildCompositeAbi,
  mergeNatspecDocs,
} from './sources/diamond'
import type { RawFacet } from './sources/diamond'

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

    const repoPromise = isEnabled(sources, 'repository')
      ? fetchRepository(address).catch(() => null)
      : Promise.resolve(null)

    const uriPromise = isEnabled(sources, 'contractURI') && rpc
      ? fetchContractURI(address).catch(() => null)
      : Promise.resolve(null)

    const srcPromise = isEnabled(sources, 'sourcify')
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
      await expandDiamond(result, rawFacets, srcResult, sourcifyLayer, uriResult, repoResult)
    }

    return result
  }

  async function expandDiamond(
    result: ContractResult,
    rawFacets: RawFacet[],
    srcResult: SourcifyResult | null,
    sourcifyLayer: Partial<ContractMetadataDocument> | null,
    uriResult: Partial<ContractMetadataDocument> | null,
    repoResult: Partial<ContractMetadataDocument> | null,
  ): Promise<void> {
    // Fetch Sourcify directly per facet (not through client.get) — this is
    // the structural recursion guard against facets that themselves look like diamonds.
    const facetSrcResults = await Promise.all(
      rawFacets.map(async rf => {
        const src = await fetchSrc(chainId, rf.facetAddress, fetchFn, sourcifyUrl).catch(() => null)
        return { raw: rf, src }
      }),
    )

    const facets: FacetInfo[] = facetSrcResults.map(({ raw, src }) => {
      const info: FacetInfo = {
        address: raw.facetAddress,
        selectors: raw.functionSelectors,
      }
      if (src?.abi) info.abi = filterAbiBySelectors(src.abi, raw.functionSelectors)
      if (src?.userdoc || src?.devdoc) {
        info.natspec = { userdoc: src.userdoc, devdoc: src.devdoc }
      }
      return info
    })

    result.facets = facets

    // Composite ABI: main diamond first (it may legitimately mount Loupe + admin
    // functions itself), then each facet's filtered ABI. First-occurrence wins.
    const abiLayers: unknown[][] = []
    if (srcResult?.abi) abiLayers.push(srcResult.abi)
    for (const f of facets) if (f.abi) abiLayers.push(f.abi)
    if (abiLayers.length > 0) {
      result.abi = buildCompositeAbi(abiLayers)
    }

    // Re-merge metadata with facet natspec layers at lowest priority so curated
    // repo/contractURI/main-sourcify docs still win.
    const facetLayers = facetSrcResults
      .map(({ src }) => src && buildSourcifyLayer(src))
      .filter((l): l is Partial<ContractMetadataDocument> => l !== null && l !== undefined)
    if (facetLayers.length > 0) {
      const rebuilt = merge(...facetLayers, sourcifyLayer, uriResult, repoResult)
      result.metadata = { ...rebuilt, chainId, address: result.address } as ContractMetadataDocument
    }

    const userdocMerged = mergeNatspecDocs(
      srcResult?.userdoc,
      ...facets.map(f => f.natspec?.userdoc),
    )
    const devdocMerged = mergeNatspecDocs(
      srcResult?.devdoc,
      ...facets.map(f => f.natspec?.devdoc),
    )
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

  return { get, fetchRepository, fetchContractURI, fetchSourcify }
}

// Re-exports
export { merge } from './merge'

export {
  ContractMetadataError,
  ContractMetadataFetchError,
  ContractMetadataNotFoundError,
  ENSResolutionError,
} from './errors'

export type {
  ContractMetadataDocument,
  ContractClientConfig,
  ContractClient,
  ContractResult,
  FacetInfo,
  NatSpec,
  GetOptions,
  IncludeFields,
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
