import { describe, it, expect, vi } from 'vitest'
import { merge, resolveIncludes } from '../src/merge'

describe('merge', () => {
  it('returns empty object for no layers', () => {
    expect(merge()).toEqual({})
  })

  it('returns empty object for all null layers', () => {
    expect(merge(null, undefined, null)).toEqual({})
  })

  it('passes through a single layer', () => {
    const layer = { name: 'WETH', symbol: 'WETH' }
    expect(merge(layer)).toEqual(layer)
  })

  it('higher priority scalar overwrites lower', () => {
    const low = { name: 'From Sourcify', description: 'Low priority' }
    const high = { name: 'From Repo' }
    expect(merge(low, high)).toEqual({
      name: 'From Repo',
      description: 'Low priority',
    })
  })

  it('skips undefined values', () => {
    const low = { name: 'Keep', symbol: 'K' }
    const high = { name: undefined, symbol: 'NEW' }
    expect(merge(low, high as any)).toEqual({ name: 'Keep', symbol: 'NEW' })
  })

  it('merges record sections per-key', () => {
    const low = {
      actions: {
        transfer: { function: 'transfer', description: 'from natspec' },
        approve: { function: 'approve', description: 'from natspec' },
      },
    }
    const high = {
      actions: {
        transfer: { function: 'transfer', title: 'Transfer', description: 'from repo' },
      },
    }

    const result = merge(low, high)
    expect(result.actions).toEqual({
      transfer: { function: 'transfer', title: 'Transfer', description: 'from repo' },
      approve: { function: 'approve', description: 'from natspec' },
    })
  })

  it('merges events per-key', () => {
    const low = { events: { Transfer: { description: 'low' } } }
    const high = { events: { Approval: { description: 'high' } } }

    expect(merge(low, high)).toEqual({
      events: {
        Transfer: { description: 'low' },
        Approval: { description: 'high' },
      },
    })
  })

  it('higher priority record key fully replaces lower', () => {
    const low = {
      actions: {
        transfer: { function: 'transfer', description: 'old', title: 'Old Title' },
      },
    }
    const high = {
      actions: {
        transfer: { function: 'transfer', description: 'new' },
      },
    }

    // Per-key replacement, not deep merge
    expect(merge(low, high).actions?.transfer).toEqual({ function: 'transfer', description: 'new' })
  })

  it('array fields use highest priority', () => {
    const low = { tags: ['defi', 'token'] }
    const high = { tags: ['curated'] }

    expect(merge(low, high)).toEqual({ tags: ['curated'] })
  })

  it('preserves extension keys', () => {
    const layer = { _component: 'custom-viewer' }
    expect(merge(layer as any)).toEqual({ _component: 'custom-viewer' })
  })

  it('merges three layers correctly', () => {
    const sourcify = {
      name: 'From Sourcify',
      actions: { transfer: { function: 'transfer', description: 'natspec' } },
    }
    const contractUri = {
      name: 'From Contract',
      image: 'https://example.com/logo.png',
    }
    const repo = {
      actions: {
        transfer: { function: 'transfer', title: 'Transfer', description: 'curated' },
        approve: { function: 'approve', title: 'Approve' },
      },
    }

    const result = merge(sourcify, contractUri, repo)
    expect(result.name).toBe('From Contract')
    expect(result.image).toBe('https://example.com/logo.png')
    expect(result.actions?.transfer).toEqual({ function: 'transfer', title: 'Transfer', description: 'curated' })
    expect(result.actions?.approve).toEqual({ function: 'approve', title: 'Approve' })
  })

  it('is immune to prototype pollution via __proto__/constructor/prototype keys', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"bad":1},"prototype":{"worse":2},"name":"ok"}')

    const result = merge(hostile)

    expect(result).toEqual({ name: 'ok' })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((result as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('resolveIncludes', () => {
  const erc20Layer = {
    name: 'ERC-20 base',
    actions: { transfer: { function: 'transfer', title: 'Transfer' } },
  }

  function includesFetch(routes: Record<string, unknown>) {
    return vi.fn(async (url: string) => {
      if (url in routes) {
        return { ok: true, status: 200, json: () => Promise.resolve(routes[url]) }
      }
      return { ok: false, status: 404, json: () => Promise.resolve(null) }
    }) as unknown as typeof fetch
  }

  it('returns the document untouched when it has no includes', async () => {
    const doc = { name: 'Plain' }
    const fetchFn = includesFetch({})
    expect(await resolveIncludes(doc, fetchFn, 'https://schema.test')).toBe(doc)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('resolves interface: form against the schema base URL', async () => {
    const fetchFn = includesFetch({
      'https://schema.test/interfaces/erc20.json': erc20Layer,
    })

    const result = await resolveIncludes(
      { includes: ['interface:erc20'], name: 'My Token' },
      fetchFn,
      'https://schema.test',
    )

    expect(fetchFn).toHaveBeenCalledWith(
      'https://schema.test/interfaces/erc20.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.name).toBe('My Token') // doc wins over interface
    expect(result.actions?.transfer?.title).toBe('Transfer')
  })

  it('resolves bare names as interfaces too', async () => {
    const fetchFn = includesFetch({
      'https://schema.test/interfaces/erc20.json': erc20Layer,
    })

    const result = await resolveIncludes({ includes: ['erc20'] }, fetchFn, 'https://schema.test')
    expect(result.actions?.transfer).toBeTruthy()
  })

  it('resolves https URL-form includes directly', async () => {
    const fetchFn = includesFetch({
      'https://example.com/shared/ownable.json': { actions: { renounceOwnership: { title: 'Renounce' } } },
    })

    const result = await resolveIncludes(
      { includes: ['https://example.com/shared/ownable.json'] },
      fetchFn,
      'https://schema.test',
    )
    expect(result.actions?.renounceOwnership?.title).toBe('Renounce')
  })

  it('rejects http: URL-form includes without fetching them', async () => {
    const fetchFn = includesFetch({
      'http://example.com/evil.json': { name: 'evil' },
    })

    const result = await resolveIncludes(
      { includes: ['http://example.com/evil.json'], name: 'Safe' },
      fetchFn,
      'https://schema.test',
    )

    expect(result).toEqual({ includes: ['http://example.com/evil.json'], name: 'Safe' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('merges interfaces left-to-right with the document on top', async () => {
    const fetchFn = includesFetch({
      'https://schema.test/interfaces/a.json': { name: 'A', symbol: 'AAA', description: 'from a' },
      'https://schema.test/interfaces/b.json': { name: 'B', symbol: 'BBB' },
    })

    const result = await resolveIncludes(
      { includes: ['a', 'b'], name: 'Doc' },
      fetchFn,
      'https://schema.test',
    )

    expect(result.name).toBe('Doc')       // document overlays everything
    expect(result.symbol).toBe('BBB')     // later interface wins over earlier
    expect(result.description).toBe('from a')
  })

  it('swallows fetch errors and missing interfaces', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('boom')) throw new Error('network down')
      return { ok: false, status: 404, json: () => Promise.resolve(null) }
    }) as unknown as typeof fetch

    const result = await resolveIncludes(
      { includes: ['boom', 'missing'], name: 'Still here' },
      fetchFn,
      'https://schema.test',
    )
    expect(result.name).toBe('Still here')
  })
})
