import { parse, toMetadata } from '@1001-digital/natspec'
import type { SourcifyUserDoc, SourcifyDevDoc } from '@1001-digital/natspec'
import type {
  AbiItem,
  ContractMetadataDocument,
  SourcifyResult,
  ActionMeta,
  EventMeta,
  ErrorMeta,
} from '../types'
import { ContractMetadataFetchError } from '../errors'
import { isRecord } from '../merge'

const DEFAULT_SOURCIFY_URL = 'https://sourcify.dev/server'

interface SourcifySource {
  content: string
}

interface SourcifyResponse {
  abi?: unknown[]
  userdoc?: SourcifyUserDoc
  devdoc?: SourcifyDevDoc
  runtimeBytecode?: { onchainBytecode?: string }
  sources?: Record<string, SourcifySource>
}

const BASE_FIELDS = ['abi', 'userdoc', 'devdoc'] as const

/**
 * The field selectors the Sourcify v2 `GET /v2/contract/{chainId}/{address}`
 * endpoint accepts. Anything else makes the live API respond with HTTP 400
 * (notably `deployedBytecode`, which is NOT a valid selector — the onchain
 * bytecode lives under `runtimeBytecode.onchainBytecode`).
 */
export const SOURCIFY_V2_FIELDS = new Set([
  'matchId',
  'creationMatch',
  'runtimeMatch',
  'verifiedAt',
  'abi',
  'userdoc',
  'devdoc',
  'metadata',
  'sources',
  'sourceIds',
  'storageLayout',
  'runtimeBytecode',
  'creationBytecode',
  'deployment',
  'compilation',
  'proxyResolution',
  'stdJsonInput',
  'stdJsonOutput',
])

/**
 * Build the `fields` query value: base fields + extras, mapped to valid
 * Sourcify v2 selectors (legacy `deployedBytecode` → `runtimeBytecode`),
 * deduplicated, and filtered against {@link SOURCIFY_V2_FIELDS} so an
 * invalid selector can never reach the API.
 */
export function buildSourcifyFields(extraFields?: string[]): string {
  const fields: string[] = [...BASE_FIELDS]
  for (const field of extraFields ?? []) {
    const mapped = field === 'deployedBytecode' ? 'runtimeBytecode' : field
    if (SOURCIFY_V2_FIELDS.has(mapped) && !fields.includes(mapped)) {
      fields.push(mapped)
    }
  }
  return fields.join(',')
}

export interface SourcifyFetchStatus {
  result: SourcifyResult | null
  notFound: boolean
}

export async function fetchSourcify(
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  baseUrl = DEFAULT_SOURCIFY_URL,
  extraFields?: string[],
): Promise<SourcifyResult | null> {
  const { result } = await fetchSourcifyWithStatus(
    chainId, address, fetchFn, baseUrl, extraFields,
  )
  return result
}

export async function fetchSourcifyWithStatus(
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  baseUrl = DEFAULT_SOURCIFY_URL,
  extraFields?: string[],
): Promise<SourcifyFetchStatus> {
  const fields = buildSourcifyFields(extraFields)
  const url = `${baseUrl}/v2/contract/${chainId}/${address}?fields=${fields}`

  let res: Response
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    throw new ContractMetadataFetchError(
      'sourcify', 0, 'Sourcify fetch failed', { cause: e },
    )
  }

  if (res.status === 404) return { result: null, notFound: true }
  if (!res.ok) {
    throw new ContractMetadataFetchError(
      'sourcify', res.status, `Sourcify returned ${res.status}`,
    )
  }

  let data: SourcifyResponse
  let metadata: ReturnType<typeof toMetadata>
  try {
    const json: unknown = await res.json()
    if (!isRecord(json)) {
      throw new Error('Sourcify response is not a JSON object')
    }
    data = json as SourcifyResponse

    const userdoc = isRecord(data.userdoc) ? data.userdoc : { methods: {} }
    const devdoc = isRecord(data.devdoc) ? data.devdoc : { methods: {} }
    metadata = toMetadata(parse(userdoc, devdoc))
  } catch (e) {
    throw new ContractMetadataFetchError(
      'sourcify', res.status, 'Invalid response from Sourcify', { cause: e },
    )
  }

  const result: SourcifyResult = {}

  if (Array.isArray(data.abi)) result.abi = data.abi as AbiItem[]
  if (isRecord(data.userdoc)) result.userdoc = data.userdoc as Record<string, unknown>
  if (isRecord(data.devdoc)) result.devdoc = data.devdoc as Record<string, unknown>
  // Sourcify v2 exposes the onchain runtime bytecode under
  // `runtimeBytecode.onchainBytecode`; surface it as `deployedBytecode`.
  if (typeof data.runtimeBytecode?.onchainBytecode === 'string') {
    result.deployedBytecode = data.runtimeBytecode.onchainBytecode
  }
  if (isRecord(data.sources)) {
    result.sources = Object.fromEntries(
      Object.entries(data.sources).map(([path, src]) => [path, src.content]),
    )
  }
  // Convert NatSpec-derived `functions` (keyed by name/signature) into the
  // `actions` shape: each action's identifier is the original key, and a
  // `function` field references the same ABI entry. This is a 1:1 mapping —
  // NatSpec has no notion of variants, so every derived action is a default.
  if (metadata.functions && Object.keys(metadata.functions).length > 0) {
    const actions: Record<string, ActionMeta> = {}
    for (const [key, fn] of Object.entries(metadata.functions)) {
      actions[key] = { function: key, ...(fn as Omit<ActionMeta, 'function'>) }
    }
    result.actions = actions
  }
  if (metadata.events && Object.keys(metadata.events).length > 0) {
    result.events = metadata.events as Record<string, EventMeta>
  }
  if (metadata.errors && Object.keys(metadata.errors).length > 0) {
    result.errors = metadata.errors as Record<string, ErrorMeta>
  }

  return {
    result: Object.keys(result).length > 0 ? result : null,
    notFound: false,
  }
}

/**
 * Extract the metadata-doc layer (actions/events/errors) from a SourcifyResult.
 * Returns null when the SourcifyResult has no NatSpec-derived sections.
 */
export function buildSourcifyLayer(
  src: SourcifyResult,
): Partial<ContractMetadataDocument> | null {
  const layer: Partial<ContractMetadataDocument> = {}
  if (src.actions) layer.actions = src.actions
  if (src.events) layer.events = src.events
  if (src.errors) layer.errors = src.errors
  return Object.keys(layer).length > 0 ? layer : null
}
