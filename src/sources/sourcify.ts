import { parse, toMetadata } from '@1001-digital/natspec'
import type { SourcifyUserDoc, SourcifyDevDoc } from '@1001-digital/natspec'
import type { SourcifyResult, FunctionMeta, EventMeta, ErrorMeta } from '../types'
import { ContractMetadataFetchError } from '../errors'

const DEFAULT_SOURCIFY_URL = 'https://sourcify.dev/server'

interface SourcifySource {
  content: string
}

interface SourcifyResponse {
  abi?: unknown[]
  userdoc?: SourcifyUserDoc
  devdoc?: SourcifyDevDoc
  deployedBytecode?: string
  sources?: Record<string, SourcifySource>
}

const BASE_FIELDS = 'abi,userdoc,devdoc'

export async function fetchSourcify(
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  baseUrl = DEFAULT_SOURCIFY_URL,
  extraFields?: string[],
): Promise<SourcifyResult | null> {
  const fields = extraFields?.length
    ? `${BASE_FIELDS},${extraFields.join(',')}`
    : BASE_FIELDS
  const url = `${baseUrl}/v2/contract/${chainId}/${address}?fields=${fields}`

  let res: Response
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    throw new ContractMetadataFetchError(
      'sourcify', 0, 'Sourcify fetch failed', { cause: e },
    )
  }

  if (res.status === 404) return null
  if (!res.ok) {
    throw new ContractMetadataFetchError(
      'sourcify', res.status, `Sourcify returned ${res.status}`,
    )
  }

  let data: SourcifyResponse
  try {
    data = await res.json() as SourcifyResponse
  } catch (e) {
    throw new ContractMetadataFetchError(
      'sourcify', res.status, 'Invalid JSON from Sourcify', { cause: e },
    )
  }

  const userdoc = data.userdoc ?? { methods: {} }
  const devdoc = data.devdoc ?? { methods: {} }

  const natspec = parse(userdoc, devdoc)
  const metadata = toMetadata(natspec)

  const result: SourcifyResult = {}

  if (data.abi) result.abi = data.abi
  if (data.userdoc) result.userdoc = data.userdoc as Record<string, unknown>
  if (data.devdoc) result.devdoc = data.devdoc as Record<string, unknown>
  if (data.deployedBytecode) result.deployedBytecode = data.deployedBytecode
  if (data.sources) {
    result.sources = Object.fromEntries(
      Object.entries(data.sources).map(([path, src]) => [path, src.content]),
    )
  }
  if (metadata.functions && Object.keys(metadata.functions).length > 0) {
    result.functions = metadata.functions as Record<string, FunctionMeta>
  }
  if (metadata.events && Object.keys(metadata.events).length > 0) {
    result.events = metadata.events as Record<string, EventMeta>
  }
  if (metadata.errors && Object.keys(metadata.errors).length > 0) {
    result.errors = metadata.errors as Record<string, ErrorMeta>
  }

  return Object.keys(result).length > 0 ? result : null
}
