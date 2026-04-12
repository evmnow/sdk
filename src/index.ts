import type {
  ContractClientConfig,
  ContractClient,
  ContractMetadataDocument,
  ContractResult,
  GetOptions,
  IncludeFields,
  SourcifyResult,
  SourceConfig,
} from './types'
import { ContractMetadataNotFoundError } from './errors'
import { merge, resolveIncludes } from './merge'
import { resolveEns } from './rpc'
import { fetchRepository as fetchRepo } from './sources/repository'
import { fetchContractURI as fetchUri } from './sources/contract-uri'
import { fetchSourcify as fetchSrc } from './sources/sourcify'

const DEFAULT_SCHEMA_BASE =
  'https://raw.githubusercontent.com/evmnow/contract-metadata/refs/heads/main/schema'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export function createContractClient(config: ContractClientConfig): ContractClient {
  const chainId = config.chainId
  const rpc = config.rpc
  const repositoryUrl = config.repositoryUrl?.replace(/\/$/, '')
  const sourcifyUrl = config.sourcifyUrl?.replace(/\/$/, '')
  const ipfsGateway = config.ipfsGateway?.replace(/\/$/, '')
  const fetchFn = config.fetch ?? globalThis.fetch
  const defaultSources = config.sources ?? {}
  const defaultInclude = config.include ?? {}

  async function resolveAddress(addressOrEns: string): Promise<string> {
    if (ADDRESS_RE.test(addressOrEns)) {
      return addressOrEns.toLowerCase()
    }

    if (addressOrEns.endsWith('.eth')) {
      if (!rpc) {
        throw new Error('RPC URL required for ENS resolution')
      }
      const resolved = await resolveEns(rpc, addressOrEns, fetchFn)
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

    // Build list of extra Sourcify fields based on include options
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

    const [repoRaw, uriResult, srcResult] = await Promise.all([
      repoPromise, uriPromise, srcPromise,
    ])

    // Resolve includes in repository result
    let repoResult = repoRaw
    if (repoResult?.includes) {
      repoResult = await resolveIncludes(repoResult, fetchFn, DEFAULT_SCHEMA_BASE)
    }

    const sourcifyLayer: Partial<ContractMetadataDocument> | null = srcResult
      ? buildSourcifyLayer(srcResult)
      : null

    // Merge: lowest priority first
    const merged = merge(sourcifyLayer, uriResult, repoResult)

    if (Object.keys(merged).length === 0) {
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

    return result
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

function buildSourcifyLayer(src: SourcifyResult): Partial<ContractMetadataDocument> | null {
  const layer: Partial<ContractMetadataDocument> = {}

  if (src.name) layer.name = src.name
  if (src.functions) layer.functions = src.functions
  if (src.events) layer.events = src.events
  if (src.errors) layer.errors = src.errors

  return Object.keys(layer).length > 0 ? layer : null
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
