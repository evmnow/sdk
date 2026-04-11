const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io'

export async function resolveUri(
  uri: string,
  fetchFn: typeof fetch,
  ipfsGateway = DEFAULT_IPFS_GATEWAY,
): Promise<Record<string, unknown> | null> {
  if (uri.startsWith('data:application/json;base64,')) {
    const b64 = uri.slice('data:application/json;base64,'.length)
    return JSON.parse(atob(b64))
  }

  const utf8Match = uri.match(/^data:application\/json;utf-?8,/)
  if (utf8Match) {
    return JSON.parse(decodeURIComponent(uri.slice(utf8Match[0].length)))
  }

  if (uri.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)))
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetchFn(uri, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  }

  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length)
    const gateway = ipfsGateway.replace(/\/$/, '')
    const res = await fetchFn(`${gateway}/ipfs/${path}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  }

  return null
}
