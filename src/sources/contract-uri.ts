import type { ContractMetadataDocument } from '../types'
import { ethCall, encodeContractUriCall, decodeAbiString } from '../rpc'
import { resolveUri } from '../uri'

// ERC-7572 fields that contractURI can provide
const ERC7572_FIELDS = [
  'name', 'symbol', 'description', 'image',
  'banner_image', 'featured_image', 'external_link', 'collaborators',
] as const

export async function fetchContractURI(
  chainId: number,
  address: string,
  rpc: string,
  fetchFn: typeof fetch,
  ipfsGateway?: string,
): Promise<Partial<ContractMetadataDocument> | null> {
  let result: string
  try {
    result = await ethCall(rpc, address, encodeContractUriCall(), fetchFn)
  } catch {
    return null
  }

  if (result === '0x' || result.length < 130) return null

  let uri: string
  try {
    uri = decodeAbiString(result)
  } catch {
    return null
  }

  if (!uri) return null

  let json: Record<string, unknown> | null
  try {
    json = await resolveUri(uri, fetchFn, ipfsGateway)
  } catch {
    return null
  }

  if (!json) return null

  // Extract only ERC-7572 fields
  const doc: Partial<ContractMetadataDocument> = {}
  for (const field of ERC7572_FIELDS) {
    if (json[field] !== undefined) {
      (doc as Record<string, unknown>)[field] = json[field]
    }
  }

  return Object.keys(doc).length > 0 ? doc : null
}
