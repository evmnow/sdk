import { describe, it, expect } from 'vitest'
import {
  amountKind,
  isAmountType,
  resolveAmountDisplay,
  formatUnits,
  parseUnits,
  formatAmount,
  parseAmount,
} from '../src/format'

describe('amountKind / isAmountType', () => {
  it('classifies string amount types', () => {
    expect(amountKind('eth')).toBe('eth')
    expect(amountKind('gwei')).toBe('gwei')
    expect(amountKind('token-amount')).toBe('token-amount')
  })

  it('classifies object amount types', () => {
    expect(amountKind({ type: 'amount', decimals: 6 })).toBe('amount')
    expect(amountKind({ type: 'token-amount', tokenAddress: '0x' })).toBe('token-amount')
  })

  it('returns null for non-amount types', () => {
    expect(amountKind('address')).toBeNull()
    expect(amountKind('timestamp')).toBeNull()
    expect(amountKind('token-id')).toBeNull()
    expect(amountKind({ type: 'token-id', tokenAddress: '0x' })).toBeNull()
    expect(amountKind(undefined)).toBeNull()
    expect(amountKind(null)).toBeNull()
  })

  it('isAmountType mirrors amountKind', () => {
    expect(isAmountType('eth')).toBe(true)
    expect(isAmountType('percentage')).toBe(false)
  })
})

describe('resolveAmountDisplay', () => {
  it('resolves eth and gwei to fixed decimals/symbol', () => {
    expect(resolveAmountDisplay('eth')).toEqual({ decimals: 18, symbol: 'ETH' })
    expect(resolveAmountDisplay('gwei')).toEqual({ decimals: 9, symbol: 'gwei' })
  })

  it('resolves amount with defaults and overrides', () => {
    expect(resolveAmountDisplay({ type: 'amount' })).toEqual({ decimals: 18, symbol: undefined })
    expect(resolveAmountDisplay({ type: 'amount', decimals: 8, symbol: 'USD' })).toEqual({
      decimals: 8,
      symbol: 'USD',
    })
  })

  it('resolves token-amount from token info, falling back to 18 when unresolved', () => {
    const t = { type: 'token-amount', tokenAddress: '0xabc' } as const
    expect(resolveAmountDisplay(t)).toEqual({ decimals: 18 })
    expect(resolveAmountDisplay(t, { decimals: 6, symbol: 'USDC' })).toEqual({
      decimals: 6,
      symbol: 'USDC',
    })
    expect(resolveAmountDisplay('token-amount', { decimals: 6, symbol: 'USDC' })).toEqual({
      decimals: 6,
      symbol: 'USDC',
    })
  })

  it('returns null for non-amount types', () => {
    expect(resolveAmountDisplay('address')).toBeNull()
  })
})

describe('formatUnits', () => {
  it('formats whole and fractional values', () => {
    expect(formatUnits(1500000000000000000n, 18)).toBe('1.5')
    expect(formatUnits(1000000000000000000n, 18)).toBe('1')
    expect(formatUnits(0n, 18)).toBe('0')
  })

  it('strips trailing zeros', () => {
    expect(formatUnits(1230000000000000000n, 18)).toBe('1.23')
  })

  it('handles tiny values', () => {
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001')
  })

  it('accepts string and number input', () => {
    expect(formatUnits('2500000000', 9)).toBe('2.5')
    expect(formatUnits(2500000000, 9)).toBe('2.5')
  })

  it('handles negatives', () => {
    expect(formatUnits(-1500000000000000000n, 18)).toBe('-1.5')
  })

  it('handles zero decimals', () => {
    expect(formatUnits(42n, 0)).toBe('42')
  })
})

describe('parseUnits', () => {
  it('parses whole and fractional values', () => {
    expect(parseUnits('1.5', 18)).toBe(1500000000000000000n)
    expect(parseUnits('1', 18)).toBe(1000000000000000000n)
    expect(parseUnits('0', 18)).toBe(0n)
  })

  it('parses leading-dot and trailing-dot forms', () => {
    expect(parseUnits('.5', 18)).toBe(500000000000000000n)
    expect(parseUnits('2.5', 9)).toBe(2500000000n)
  })

  it('rounds excess precision half-up', () => {
    expect(parseUnits('1.5', 0)).toBe(2n)
    expect(parseUnits('1.4', 0)).toBe(1n)
    expect(parseUnits('0.0000005', 6)).toBe(1n)
  })

  it('handles negatives', () => {
    expect(parseUnits('-1.5', 18)).toBe(-1500000000000000000n)
  })

  it('round-trips with formatUnits', () => {
    expect(formatUnits(parseUnits('123.456', 18), 18)).toBe('123.456')
  })

  it('rejects invalid input', () => {
    expect(() => parseUnits('', 18)).toThrow()
    expect(() => parseUnits('abc', 18)).toThrow()
    expect(() => parseUnits('1.2.3', 18)).toThrow()
    expect(() => parseUnits('.', 18)).toThrow()
  })
})

describe('formatAmount', () => {
  it('formats eth and gwei with symbol', () => {
    expect(formatAmount(1500000000000000000n, 'eth')).toBe('1.5 ETH')
    expect(formatAmount(2500000000n, 'gwei')).toBe('2.5 gwei')
  })

  it('formats generic amount, honoring symbol toggle', () => {
    expect(formatAmount(123456789n, { type: 'amount', decimals: 6 }, { symbol: false })).toBe('123.456789')
    expect(formatAmount(123456789n, { type: 'amount', decimals: 6, symbol: 'USD' })).toBe('123.456789 USD')
  })

  it('formats token-amount from token info', () => {
    const t = { type: 'token-amount', tokenAddress: '0xabc' } as const
    expect(formatAmount(1000000n, t, { tokenInfo: { decimals: 6, symbol: 'USDC' } })).toBe('1 USDC')
  })

  it('groups thousands by default and can disable it', () => {
    expect(formatAmount(1234567000000000000000n, 'eth')).toBe('1,234.567 ETH')
    expect(formatAmount(1234567000000000000000n, 'eth', { group: false })).toBe('1234.567 ETH')
  })

  it('caps fractional digits with rounding', () => {
    expect(formatAmount(1239999999999999999n, 'eth', { maxDecimals: 2 })).toBe('1.24 ETH')
    expect(formatAmount(1234000000000000000n, 'eth', { maxDecimals: 2 })).toBe('1.23 ETH')
  })

  it('returns null for non-amount types', () => {
    expect(formatAmount(1n, 'address')).toBeNull()
    expect(formatAmount(1n, undefined)).toBeNull()
  })
})

describe('parseAmount', () => {
  it('parses using the resolved decimals', () => {
    expect(parseAmount('1.5', 'eth')).toBe(1500000000000000000n)
    expect(parseAmount('2.5', 'gwei')).toBe(2500000000n)
    expect(parseAmount('1', { type: 'token-amount', tokenAddress: '0x' }, { decimals: 6 })).toBe(1000000n)
  })

  it('throws for non-amount types', () => {
    expect(() => parseAmount('1', 'address')).toThrow()
  })
})
