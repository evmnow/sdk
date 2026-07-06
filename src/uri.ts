const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io'

// Cap remote metadata responses (~1 MB) — a contractURI points at untrusted
// infrastructure that must not be able to balloon memory.
const MAX_RESPONSE_BYTES = 1_000_000

export async function resolveUri(
  uri: string,
  fetchFn: typeof fetch,
  ipfsGateway = DEFAULT_IPFS_GATEWAY,
): Promise<Record<string, unknown> | null> {
  if (uri.startsWith('data:application/json;base64,')) {
    const b64 = uri.slice('data:application/json;base64,'.length)
    return JSON.parse(atob(b64))
  }

  // Plain-JSON data URIs: `data:application/json,`, plus the `;utf8`,
  // `;utf-8`, and `;charset=utf-8` parameter variants.
  const plainMatch = uri.match(/^data:application\/json(?:;(?:charset=)?utf-?8)?,/i)
  if (plainMatch) {
    return JSON.parse(decodeURIComponent(uri.slice(plainMatch[0].length)))
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetchFn(uri, { signal: AbortSignal.timeout(5_000) })
    return readJsonCapped(res)
  }

  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length)
    const gateway = ipfsGateway.replace(/\/$/, '')
    const res = await fetchFn(`${gateway}/ipfs/${path}`, { signal: AbortSignal.timeout(10_000) })
    return readJsonCapped(res)
  }

  return null
}

async function readJsonCapped(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.ok) return null

  const contentLength = res.headers?.get?.('content-length')
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) return null

  const text = await res.text()
  if (text.length > MAX_RESPONSE_BYTES) return null

  return JSON.parse(text) as Record<string, unknown>
}
