import { describe, it, expect } from 'vitest'
import { renderIntent } from '../src/intent'
import { MAX_UINT256 } from '../src/format'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const usdcInfo = { decimals: 6, symbol: 'USDC' }

describe('renderIntent', () => {
  it('returns null without an intent template', () => {
    expect(renderIntent(undefined, { args: {} })).toBeNull()
    expect(renderIntent({}, { args: {} })).toBeNull()
  })

  it('substitutes plain values and leaves unknown placeholders verbatim', () => {
    const out = renderIntent(
      { intent: 'Send {amount} to {recipient} via {missing}' },
      { args: { amount: 5n, recipient: '0xabc' } },
    )
    expect(out).toBe('Send 5 to 0xabc via {missing}')
  })

  it('prepends the hash prefix', () => {
    const out = renderIntent(
      { intent: 'Buy Punk #{punkIndex}' },
      { args: { punkIndex: 7804n } },
    )
    expect(out).toBe('Buy Punk #7804')
  })

  it('formats amount-like params by their semantic type', () => {
    const out = renderIntent(
      {
        intent: 'List for {price}',
        params: { price: { type: 'eth' } },
      },
      { args: { price: 1500000000000000000n } },
    )
    expect(out).toBe('List for 1.5 ETH')
  })

  it('formats bare token-amount against the described contract', () => {
    const out = renderIntent(
      {
        intent: 'Transfer {value} to {to}',
        params: { value: { type: 'token-amount' }, to: { type: 'address' } },
      },
      {
        args: { value: 12500000n, to: '0xabc' },
        contractAddress: USDC,
        resolveToken: (addr) => (addr === USDC ? usdcInfo : undefined),
      },
    )
    expect(out).toBe('Transfer 12.5 USDC to 0xabc')
  })

  it('resolves tokenParam references through the args', () => {
    const out = renderIntent(
      {
        intent: 'Rescue {amount} of {tokenContract} to {to}',
        params: {
          amount: { type: { type: 'token-amount', tokenParam: 'tokenContract' } },
        },
      },
      {
        args: {
          tokenContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          to: '0xdef',
          amount: 1000000n,
        },
        resolveToken: (addr) => (addr === USDC ? usdcInfo : undefined),
      },
    )
    expect(out).toBe(
      'Rescue 1 USDC of 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 to 0xdef',
    )
  })

  it('falls back to the raw value for unresolved token-amounts — no guessing', () => {
    const out = renderIntent(
      {
        intent: 'Transfer {value}',
        params: { value: { type: 'token-amount' } },
      },
      { args: { value: 12500000n }, contractAddress: USDC },
    )
    expect(out).toBe('Transfer 12500000')
  })

  it('renders unlimited approvals', () => {
    const out = renderIntent(
      {
        intent: 'Approve {spender} to spend {amount}',
        params: { amount: { type: 'token-amount' } },
      },
      {
        args: { spender: '0xabc', amount: MAX_UINT256 },
        contractAddress: USDC,
        resolveToken: () => usdcInfo,
      },
    )
    expect(out).toBe('Approve 0xabc to spend Unlimited USDC')
  })

  it('renders {value} as transaction value unless an ABI param shadows it', () => {
    const wrap = renderIntent(
      { intent: 'Wrap {value} into WETH' },
      { args: {}, value: 1500000000000000000n },
    )
    expect(wrap).toBe('Wrap 1.5 ETH into WETH')

    const shadowed = renderIntent(
      { intent: 'Transfer {value}', params: { value: { type: 'token-amount' } } },
      {
        args: { value: 1000000n },
        value: 0n,
        contractAddress: USDC,
        resolveToken: () => usdcInfo,
      },
    )
    expect(shadowed).toBe('Transfer 1 USDC')
  })

  it('prefers the paramType callback over meta params', () => {
    const out = renderIntent(
      { intent: 'Unwrap {_0}', params: {} },
      {
        args: { _0: 2000000000000000000n },
        paramType: (key) => (key === '_0' ? 'eth' : undefined),
      },
    )
    expect(out).toBe('Unwrap 2 ETH')
  })
})
