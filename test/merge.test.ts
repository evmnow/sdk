import { describe, it, expect } from 'vitest'
import { merge } from '../src/merge'

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
})
