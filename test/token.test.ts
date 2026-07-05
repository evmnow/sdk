import { describe, it, expect, vi } from 'vitest'
import { createTokenInfoResolver } from '../src/token'

const DECIMALS_SELECTOR = '0x313ce567'
const SYMBOL_SELECTOR = '0x95d89b41'

const word = (n: number | bigint) => '0x' + BigInt(n).toString(16).padStart(64, '0')

function abiString(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  const padded = hex.padEnd(Math.ceil(bytes.length / 32) * 64, '0')
  return (
    '0x' +
    BigInt(32).toString(16).padStart(64, '0') +
    BigInt(bytes.length).toString(16).padStart(64, '0') +
    padded
  )
}

function bytes32String(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return '0x' + hex.padEnd(64, '0')
}

/** fetchFn answering decimals()/symbol() eth_calls per token address. */
function tokenRpc(
  tokens: Record<string, { decimals?: string; symbol?: string }>,
) {
  return vi.fn(async (_rpc: unknown, init: any) => {
    const body = JSON.parse(init.body)
    const { to, data } = body.params[0]
    const token = tokens[to.toLowerCase()] ?? {}
    const result =
      data === DECIMALS_SELECTOR ? token.decimals :
      data === SYMBOL_SELECTOR ? token.symbol :
      undefined
    if (result === 'revert') {
      return { ok: true, json: async () => ({ error: { message: 'execution reverted' } }) }
    }
    return { ok: true, json: async () => ({ result: result ?? '0x' }) }
  }) as unknown as typeof fetch
}

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const MKR = '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'

describe('createTokenInfoResolver', () => {
  it('resolves decimals and a dynamic-string symbol', async () => {
    const fetchFn = tokenRpc({
      [USDC]: { decimals: word(6), symbol: abiString('USDC') },
    })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    expect(await resolver.resolve(USDC)).toEqual({ decimals: 6, symbol: 'USDC' })
  })

  it('decodes legacy bytes32 symbols', async () => {
    const fetchFn = tokenRpc({
      [MKR]: { decimals: word(18), symbol: bytes32String('MKR') },
    })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    expect(await resolver.resolve(MKR)).toEqual({ decimals: 18, symbol: 'MKR' })
  })

  it('returns null when decimals cannot be resolved — callers render raw', async () => {
    const fetchFn = tokenRpc({ [USDC]: { decimals: 'revert' } })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    expect(await resolver.resolve(USDC)).toBeNull()
  })

  it('returns null for out-of-range decimals', async () => {
    const fetchFn = tokenRpc({ [USDC]: { decimals: word(1000) } })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    expect(await resolver.resolve(USDC)).toBeNull()
  })

  it('keeps decimals when symbol() fails', async () => {
    const fetchFn = tokenRpc({
      [USDC]: { decimals: word(6), symbol: 'revert' },
    })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    expect(await resolver.resolve(USDC)).toEqual({ decimals: 6 })
  })

  it('caches successes and dedupes concurrent lookups, keyed case-insensitively', async () => {
    const fetchFn = tokenRpc({
      [USDC]: { decimals: word(6), symbol: abiString('USDC') },
    })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    const [a, b] = await Promise.all([
      resolver.resolve(USDC),
      resolver.resolve(USDC.toUpperCase().replace('0X', '0x')),
    ])
    await resolver.resolve(USDC)

    expect(a).toEqual({ decimals: 6, symbol: 'USDC' })
    expect(b).toEqual(a)
    // one decimals() + one symbol() call in total
    expect((fetchFn as any).mock.calls.length).toBe(2)
  })

  it('does not cache failures', async () => {
    const fetchFn = tokenRpc({ [USDC]: { decimals: 'revert' } })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    expect(await resolver.resolve(USDC)).toBeNull()
    expect(await resolver.resolve(USDC)).toBeNull()
    // decimals() retried on the second resolve
    expect((fetchFn as any).mock.calls.length).toBe(2)
  })

  it('resolveAll omits unresolvable tokens', async () => {
    const fetchFn = tokenRpc({
      [USDC]: { decimals: word(6), symbol: abiString('USDC') },
      [MKR]: { decimals: 'revert' },
    })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    const map = await resolver.resolveAll([USDC, MKR, USDC])

    expect(map.size).toBe(1)
    expect(map.get(USDC)).toEqual({ decimals: 6, symbol: 'USDC' })
  })

  it('sanitizes hostile symbols (control chars stripped, length capped)', async () => {
    const fetchFn = tokenRpc({
      [USDC]: {
        decimals: word(6),
        symbol: abiString('US\u0000DC\u0007 SCAM-TOKEN-WITH-A-VERY-LONG-NAME'),
      },
    })
    const resolver = createTokenInfoResolver({ rpc: 'https://rpc.test', fetchFn })

    const info = await resolver.resolve(USDC)
    expect(info?.symbol).toBe('USDC SCAM-TOKEN-WITH')
    expect(info?.symbol!.length).toBeLessThanOrEqual(20)
  })
})
