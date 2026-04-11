import { parse, toMetadata } from '@1001-digital/natspec'
import type { SourcifyUserDoc, SourcifyDevDoc } from '@1001-digital/natspec'
import type { SourcifyResult, FunctionMeta, EventMeta, ErrorMeta } from '../types'
import { ContractMetadataFetchError } from '../errors'

const DEFAULT_SOURCIFY_URL = 'https://sourcify.dev/server'

interface SourcifyResponse {
  name?: string
  abi?: unknown[]
  userdoc?: SourcifyUserDoc
  devdoc?: SourcifyDevDoc
}

export async function fetchSourcify(
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  baseUrl = DEFAULT_SOURCIFY_URL,
): Promise<SourcifyResult | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/v2/contract/${chainId}/${address}?fields=abi,name,userdoc,devdoc`

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
  if (data.name) result.name = data.name
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
