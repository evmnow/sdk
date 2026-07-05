import type {
  ContractClientConfig,
  ContractClient,
  ContractMetadataDocument,
  ContractResult,
  FetchProxyOptions,
  GetOptions,
  IncludeFields,
  ProxyResolution,
  RawProxy,
  SourcifyResult,
  SourceConfig,
  TargetInfo,
} from './types'
import {
  ContractMetadataNotFoundError,
  ContractNotVerifiedOnSourcifyError,
} from './errors'
import { merge, resolveIncludes } from './merge'
import { detectInterfaces, interfaceDocuments } from './interfaces/detect'
import { resolveEns, getChainId, ethCall, decodeAbiString } from './rpc'
import { fetchRepository as fetchRepo } from './sources/repository'
import { fetchContractURI as fetchUri } from './sources/contract-uri'
import {
  fetchSourcify as fetchSrc,
  fetchSourcifyWithStatus,
  buildSourcifyLayer,
} from './sources/sourcify'
import type { SourcifyFetchStatus } from './sources/sourcify'
import {
  buildCompositeAbi,
  composeProxyResolution,
  detectProxy,
  enrichTargets,
  fetchProxy as fetchProxySource,
  mergeNatspecDocs,
} from './sources/proxy'

const DEFAULT_SCHEMA_BASE =
  'https://raw.githubusercontent.com/evmnow/contract-metadata/refs/heads/main/schema'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// ERC-20/ERC-721 metadata getters, for the on-chain identity fallback.
const NAME_SELECTOR = '0x06fdde03'    // name()
const SYMBOL_SELECTOR = '0x95d89b41'  // symbol()

type ClientSourcifyStatus = SourcifyFetchStatus & {
  unavailable?: boolean
}

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

    const srcPromise: Promise<ClientSourcifyStatus> = sourcifyEnabled
      ? fetchSourcifyWithFields(address, extraFields)
          .catch(() => ({ result: null, notFound: false, unavailable: true }))
      : Promise.resolve({ result: null, notFound: false })

    const proxyPromise: Promise<RawProxy | null> =
      isEnabled(sources, 'proxy') && rpc
        ? ensureRpcChainId()
            .then(() => detectProxy(rpc, address, fetchFn))
            .catch(() => null)
        : Promise.resolve(null)

    const [repoRaw, uriResult, srcStatus, rawProxy] = await Promise.all([
      repoPromise, uriPromise, srcPromise, proxyPromise,
    ])
    const srcResult = srcStatus.result

    let repoResult = repoRaw
    if (repoResult?.includes) {
      repoResult = await resolveIncludes(repoResult, fetchFn, DEFAULT_SCHEMA_BASE)
    }

    const sourcifyLayer: Partial<ContractMetadataDocument> | null = srcResult
      ? buildSourcifyLayer(srcResult)
      : null

    // Merge: lowest priority first
    const merged = merge(sourcifyLayer, uriResult, repoResult)

    if (Object.keys(merged).length === 0 && !srcResult?.abi && !rawProxy) {
      if (srcStatus.notFound) {
        throw new ContractNotVerifiedOnSourcifyError(chainId, address)
      }
      throw new ContractMetadataNotFoundError(chainId, address, {
        source: srcStatus.unavailable ? 'sourcify' : undefined,
        reason: srcStatus.unavailable ? 'source-unavailable' : 'empty-response',
      })
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

    if (rawProxy) {
      await expandProxy(
        result,
        rawProxy,
        sourcifyEnabled,
        include.sources === true,
        srcResult,
        sourcifyLayer,
        uriResult,
        repoResult,
      )
    }

    if (isEnabled(sources, 'interfaces')) {
      await applyStandardInterfaces(result)
    }

    return result
  }

  // Contracts whose (proxy-composed) ABI matches a token standard get the
  // bundled interface layer even without a curated document — labeled
  // actions, groups, and semantic types (e.g. token-amount returns) from the
  // ABI alone. Authored layers stay authoritative: the interface layer merges
  // at the lowest priority.
  async function applyStandardInterfaces(result: ContractResult): Promise<void> {
    const detected = detectInterfaces(result.abi ?? [])
    if (detected.length === 0) return
    result.interfaces = detected

    const layers = detected.map(id => interfaceDocuments[id])
    result.metadata = {
      ...merge(...layers, result.metadata),
      chainId,
      address: result.address,
    } as ContractMetadataDocument

    // Token identity lives on-chain anyway — fill whatever no layer set.
    if (!rpc || (result.metadata.name && result.metadata.symbol)) return
    const fill = async (key: 'name' | 'symbol', selector: string) => {
      if (result.metadata[key]) return
      await ensureRpcChainId()
      const value = decodeAbiString(
        await ethCall(rpc, result.address, selector, fetchFn),
      )
      if (value) result.metadata[key] = value
    }
    await Promise.all([
      fill('name', NAME_SELECTOR).catch(() => undefined),
      fill('symbol', SYMBOL_SELECTOR).catch(() => undefined),
    ])
  }

  async function expandProxy(
    result: ContractResult,
    rawProxy: RawProxy,
    sourcifyEnabled: boolean,
    includeSources: boolean,
    srcResult: SourcifyResult | null,
    sourcifyLayer: Partial<ContractMetadataDocument> | null,
    uriResult: Partial<ContractMetadataDocument> | null,
    repoResult: Partial<ContractMetadataDocument> | null,
  ): Promise<void> {
    // Fetch Sourcify directly per target (not through client.get) — this is
    // the structural single-hop guard. Skipped entirely when Sourcify is disabled.
    const sourcifyFetch = sourcifyEnabled
      ? (a: string) =>
          fetchSrc(
            chainId,
            a,
            fetchFn,
            sourcifyUrl,
            includeSources ? ['sources'] : undefined,
          )
      : null

    const { targets, sourcifyResults } = await enrichTargets(rawProxy.targets, sourcifyFetch)
    const derived = composeProxyResolution(targets, sourcifyResults)

    const proxy: ProxyResolution = { pattern: rawProxy.pattern, targets, ...derived }
    if (rawProxy.beacon) proxy.beacon = rawProxy.beacon
    if (rawProxy.admin) proxy.admin = rawProxy.admin
    result.proxy = proxy
    mergeProxySources(result, proxy)

    // Composite ABI: main contract first (it may legitimately mount admin/loupe
    // functions itself), then each target's filtered ABI. First-occurrence wins.
    // When the main contract isn't verified, reuse the target-only composite.
    if (srcResult?.abi) {
      const layers: unknown[][] = [srcResult.abi]
      for (const t of targets) if (t.abi) layers.push(t.abi)
      result.abi = buildCompositeAbi(layers)
    } else if (derived.compositeAbi) {
      result.abi = derived.compositeAbi
    }

    // Re-merge metadata with target layer at lowest priority so curated
    // repo/contractURI/main-sourcify docs still win.
    if (derived.metadataLayer) {
      const rebuilt = merge(derived.metadataLayer, sourcifyLayer, uriResult, repoResult)
      result.metadata = {
        ...rebuilt, chainId, address: result.address,
      } as ContractMetadataDocument
    }

    // NatSpec: main contract first (highest authority), then merged target natspec.
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
  ): Promise<SourcifyFetchStatus> {
    return fetchSourcifyWithStatus(
      chainId, address, fetchFn, sourcifyUrl, extraFields,
    )
  }

  async function fetchSourcify(
    address: string,
  ): Promise<SourcifyResult | null> {
    return fetchSrc(chainId, address, fetchFn, sourcifyUrl, ['sources', 'deployedBytecode'])
  }

  async function fetchProxy(
    address: string,
    options?: FetchProxyOptions,
  ): Promise<ProxyResolution | null> {
    if (!rpc) return null
    await ensureRpcChainId()
    return fetchProxySource(rpc, chainId, address, fetchFn, {
      sourcifyUrl,
      sourcify: options?.sourcify,
      sources: options?.sources,
    })
  }

  return { get, fetchRepository, fetchContractURI, fetchSourcify, fetchProxy }
}

function mergeProxySources(result: ContractResult, proxy: ProxyResolution): void {
  const sourceTargets = proxy.targets.filter(
    (target): target is TargetInfo & { sources: Record<string, string> } =>
      !!target.sources && Object.keys(target.sources).length > 0,
  )
  if (!sourceTargets.length) return

  const existingSources = result.sources ?? {}
  const hasExistingSources = Object.keys(existingSources).length > 0
  const merged: Record<string, string> = { ...existingSources }

  for (const target of sourceTargets) {
    const isFacet = target.selectors !== undefined
    const prefixTargetPaths = hasExistingSources || sourceTargets.length > 1 || isFacet
    const prefix = isFacet
      ? `facets/${target.address}`
      : `implementations/${target.address}`

    for (const [path, content] of Object.entries(target.sources)) {
      const targetPath = prefixTargetPaths ? joinSourcePath(prefix, path) : path
      merged[targetPath] = content
    }
  }

  result.sources = merged
}

function joinSourcePath(prefix: string, path: string): string {
  return `${prefix}/${path.replace(/^\/+/, '')}`
}

// ── Re-exports ──

// Pure merge utilities
export { merge, resolveIncludes } from './merge'

// Pure amount-formatting utilities (eth/gwei/amount/token-amount)
export {
  amountKind,
  isAmountType,
  resolveAmountDisplay,
  formatUnits,
  parseUnits,
  formatAmount,
  parseAmount,
  tokenAddressOf,
  tokenParamOf,
  resolveTokenAddress,
  MAX_UINT256,
} from './format'
export type {
  AmountKind,
  TokenInfo,
  AmountDisplay,
  FormatAmountOptions,
  TokenResolutionContext,
} from './format'

// Token identity resolution (on-chain decimals()/symbol() with caching)
export { createTokenInfoResolver } from './token'
export type { TokenInfoResolver, TokenInfoResolverConfig } from './token'

// Intent template rendering
export { renderIntent } from './intent'
export type { IntentContext, IntentMeta } from './intent'

// Proxy utilities
export {
  fetchProxy,
  detectProxy,
  detectDiamond,
  detectEip1967,
  detectEip1967Beacon,
  detectEip1822,
  detectEip1167,
  detectGnosisSafe,
  detectEip897,
  enrichTargets,
  composeProxyResolution,
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  mergeNatspecDocs,
  DIAMOND_LOUPE_INTERFACE_ID,
  SUPPORTS_INTERFACE_SELECTOR,
  FACETS_SELECTOR,
  IMPLEMENTATION_SELECTOR,
  EIP1967_IMPL_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_ADMIN_SLOT,
  EIP1822_PROXIABLE_SLOT,
} from './sources/proxy'

// Standard-interface detection + bundled metadata layers
export { detectInterfaces, interfaceDocuments } from './interfaces/detect'
export { erc20Interface } from './interfaces/erc20'
export { erc721Interface } from './interfaces/erc721'

// Per-source fetchers
export { fetchRepository } from './sources/repository'
export { fetchContractURI } from './sources/contract-uri'
export {
  fetchSourcify,
  fetchSourcifyWithStatus,
  buildSourcifyLayer,
} from './sources/sourcify'
export type { SourcifyFetchStatus } from './sources/sourcify'

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
  ContractNotVerifiedOnSourcifyError,
  ENSResolutionError,
} from './errors'

export type {
  ContractMetadataNotFoundOptions,
  ContractMetadataNotFoundReason,
  MetadataSource,
} from './errors'

// Action resolution + calldata matching
export {
  resolveActions,
  matchAction,
  paramMetaAt,
  actionRequiresSender,
} from './actions'
export type {
  AbiFunction,
  AbiParam,
  ResolvedAction,
  ActionResolutionIssue,
  ActionResolutionResult,
  ActionIssueCode,
  DecodedCall,
} from './actions'

// Types
export type {
  ContractMetadataDocument,
  ContractClientConfig,
  ContractClient,
  ContractResult,
  StandardInterface,
  ProxyResolution,
  ProxyPattern,
  TargetInfo,
  RawProxy,
  ResolvedTarget,
  FetchProxyOptions,
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
  ActionMeta,
  ValueMeta,
  EventMeta,
  ErrorMeta,
  MessageMeta,
  ParamMeta,
  ParamType,
  AmountType,
  TokenAmountType,
  Autofill,
  ValidationRule,
  ParamPreview,
  ActionExample,
} from './types'
