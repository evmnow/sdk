import type { ContractMetadataDocument } from '../types'
import { isRecord } from '../merge'
import { ContractMetadataFetchError } from '../errors'

const DEFAULT_REPO_URL =
  'https://raw.githubusercontent.com/evmnow/contract-metadata/refs/heads/main/contracts'

/**
 * Fetch a curated metadata document from the repository.
 *
 * Looks up the chain-scoped layout (`{base}/{chainId}/{address}.json`) first
 * and falls back to the legacy flat layout (`{base}/{address}.json`) on a
 * miss. A document whose own `chainId` disagrees with the requested chain is
 * discarded rather than restamped.
 */
export async function fetchRepository(
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  baseUrl = DEFAULT_REPO_URL,
): Promise<Partial<ContractMetadataDocument> | null> {
  const doc =
    await fetchDocument(`${baseUrl}/${chainId}/${address}.json`, fetchFn)
    ?? await fetchDocument(`${baseUrl}/${address}.json`, fetchFn)

  if (!doc) return null
  if (typeof doc.chainId === 'number' && doc.chainId !== chainId) return null
  return doc
}

async function fetchDocument(
  url: string,
  fetchFn: typeof fetch,
): Promise<Partial<ContractMetadataDocument> | null> {
  let res: Response
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(5_000) })
  } catch (e) {
    throw new ContractMetadataFetchError(
      'repository', 0, 'Repository fetch failed', { cause: e },
    )
  }

  if (res.status === 404) return null
  if (!res.ok) {
    throw new ContractMetadataFetchError(
      'repository', res.status, `Repository returned ${res.status}`,
    )
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    throw new ContractMetadataFetchError(
      'repository', res.status, 'Invalid JSON from repository', { cause: e },
    )
  }

  // The repository serves untrusted JSON — require a plain object, and an
  // `includes` field (when present) that is an array of strings, so a
  // malformed document can't crash the merge pipeline downstream.
  if (!isRecord(json)) return null
  if (json.includes !== undefined && !isStringArray(json.includes)) return null

  return json as Partial<ContractMetadataDocument>
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(item => typeof item === 'string')
}
