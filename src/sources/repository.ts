import type { ContractMetadataDocument } from '../types'
import { ContractMetadataFetchError } from '../errors'

const DEFAULT_REPO_URL =
  'https://raw.githubusercontent.com/evmnow/contract-metadata/refs/heads/main/contracts'

export async function fetchRepository(
  chainId: number,
  address: string,
  fetchFn: typeof fetch,
  baseUrl = DEFAULT_REPO_URL,
): Promise<Partial<ContractMetadataDocument> | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/${address.toLowerCase()}.json`

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

  try {
    return await res.json() as Partial<ContractMetadataDocument>
  } catch (e) {
    throw new ContractMetadataFetchError(
      'repository', res.status, 'Invalid JSON from repository', { cause: e },
    )
  }
}
