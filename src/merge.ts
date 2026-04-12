import type { ContractMetadataDocument } from './types'

// Top-level keys that contain Record<string, object> and should merge per-key
const RECORD_SECTIONS = ['groups', 'functions', 'events', 'errors', 'messages'] as const

type RecordSection = typeof RECORD_SECTIONS[number]

/**
 * Merge metadata layers with increasing priority.
 * Pass layers from lowest to highest priority.
 * Scalar fields: highest non-undefined wins.
 * Record sections (functions, events, etc.): shallow merge per key.
 */
export function merge(
  ...layers: (Partial<ContractMetadataDocument> | null | undefined)[]
): Partial<ContractMetadataDocument> {
  const result: Record<string, unknown> = {}

  for (const layer of layers) {
    if (!layer) continue

    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue

      if (isRecordSection(key) && isRecord(value) && isRecord(result[key])) {
        result[key] = { ...(result[key] as Record<string, unknown>), ...value }
      } else {
        result[key] = value
      }
    }
  }

  return result as Partial<ContractMetadataDocument>
}

/**
 * Resolve `includes` in a metadata document.
 * Fetches each interface, merges them left-to-right,
 * then overlays the document's own fields on top.
 */
export async function resolveIncludes(
  doc: Partial<ContractMetadataDocument>,
  fetchFn: typeof fetch,
  schemaBaseUrl: string,
): Promise<Partial<ContractMetadataDocument>> {
  const includes = doc.includes
  if (!includes || includes.length === 0) return doc

  const settled = await Promise.allSettled(
    includes.map(async (id) => {
      const url = resolveInterfaceUrl(id, schemaBaseUrl)
      const res = await fetchFn(url, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) return res.json() as Promise<Partial<ContractMetadataDocument>>
      return null
    }),
  )

  const interfaces: Partial<ContractMetadataDocument>[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) interfaces.push(r.value)
  }

  // Merge interfaces left-to-right, then overlay doc on top
  const base = merge(...interfaces)
  return merge(base, doc)
}

function resolveInterfaceUrl(id: string, schemaBaseUrl: string): string {
  if (id.startsWith('http://') || id.startsWith('https://')) return id

  // Strip optional "interface:" prefix
  const name = id.startsWith('interface:') ? id.slice('interface:'.length) : id

  return `${schemaBaseUrl}/interfaces/${name}.json`
}

function isRecordSection(key: string): key is RecordSection {
  return (RECORD_SECTIONS as readonly string[]).includes(key)
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
