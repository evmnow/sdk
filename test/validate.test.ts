import { describe, it, expect } from 'vitest'
import { semanticChecks, isValidFunctionRef } from '../src/validate'

const messages = (issues: { message: string }[]) => issues.map((i) => i.message)

describe('isValidFunctionRef', () => {
  it('accepts bare names, signatures, and selectors', () => {
    expect(isValidFunctionRef('approve')).toBe(true)
    expect(isValidFunctionRef('approve(address,uint256)')).toBe(true)
    expect(isValidFunctionRef('0x095ea7b3')).toBe(true)
  })

  it('rejects malformed references', () => {
    expect(isValidFunctionRef('approve max')).toBe(false)
    expect(isValidFunctionRef('0x095e')).toBe(false)
    expect(isValidFunctionRef('9lives')).toBe(false)
  })
})

describe('semanticChecks', () => {
  it('returns no issues for a clean document', () => {
    const issues = semanticChecks({
      address: '0xabc',
      groups: { main: { label: 'Main', order: 1 } },
      actions: {
        approve: {
          group: 'main',
          related: ['revoke'],
          params: { spender: { type: 'address' } },
        },
        revoke: {
          function: 'approve',
          group: 'main',
          params: {
            amount: { autofill: { type: 'constant', value: '0' }, hidden: true },
          },
        },
      },
      events: { Transfer: {}, ['0x' + 'ab'.repeat(32)]: {} },
      errors: { NotOwner: {}, '0x08c379a0': {} },
    })
    expect(issues).toEqual([])
  })

  it('flags invalid action ids and function references', () => {
    const issues = semanticChecks({
      actions: {
        'bad id!': {},
        'my-variant': {},
        broken: { function: 'not a ref' },
      },
    })
    expect(messages(issues)).toEqual([
      expect.stringContaining('actions key "bad id!" is not a valid action id'),
      expect.stringContaining('id "bad id!" is not a valid bare function name'),
      expect.stringContaining(
        'id "my-variant" is not a valid bare function name',
      ),
      expect.stringContaining('"not a ref" is not a valid name, signature'),
    ])
  })

  it('flags unknown group and related references', () => {
    const issues = semanticChecks({
      groups: { main: { label: 'Main', order: 1 } },
      actions: {
        transfer: { group: 'nope', related: ['missing'] },
      },
    })
    expect(messages(issues)).toEqual([
      'actions.transfer.group "nope" not found in groups',
      'actions.transfer.related references unknown action "missing"',
    ])
  })

  it('does not check groups when the document defines none', () => {
    const issues = semanticChecks({
      actions: { transfer: { group: 'erc20' } },
    })
    expect(issues).toEqual([])
  })

  it('enforces input-flag contracts on params and value', () => {
    const issues = semanticChecks({
      actions: {
        mint: {
          params: {
            to: { hidden: true },
            id: {
              autofill: { type: 'constant', value: '1' },
              hidden: true,
              disabled: true,
            },
          },
          value: { disabled: true },
        },
      },
    })
    expect(messages(issues)).toEqual([
      'actions.mint.params.to.hidden requires autofill',
      'actions.mint.params.id.hidden and .disabled are mutually exclusive',
      'actions.mint.value.disabled requires autofill',
    ])
  })

  it('flags tokenAddress + tokenParam on the same type', () => {
    const issues = semanticChecks({
      actions: {
        rescue: {
          params: {
            amount: {
              type: {
                type: 'token-amount',
                tokenAddress: '0x' + 'a'.repeat(40),
                tokenParam: 'tokenContract',
              },
            },
          },
        },
      },
    })
    expect(messages(issues)).toEqual([
      expect.stringContaining('both tokenAddress and tokenParam'),
    ])
  })

  it('flags indistinguishable variants, honoring locked constraints', () => {
    const issues = semanticChecks({
      actions: {
        approve: {},
        'approve-again': { function: 'approve' },
        revoke: {
          function: 'approve',
          params: {
            amount: { autofill: { type: 'constant', value: '0' }, hidden: true },
          },
        },
      },
    })
    expect(messages(issues)).toEqual([
      expect.stringContaining(
        'actions.approve-again and actions.approve target "approve" with identical locked parameters',
      ),
    ])
  })

  it('treats block-timestamp locks as unmatchable (still ambiguous)', () => {
    const issues = semanticChecks({
      actions: {
        a: { function: 'f' },
        b: {
          function: 'f',
          params: { when: { autofill: 'block-timestamp', hidden: true } },
        },
      },
    })
    expect(messages(issues)).toEqual([
      expect.stringContaining('identical locked parameters'),
    ])
  })

  it('flags malformed event and error keys', () => {
    const issues = semanticChecks({
      events: { 'Transfer(address,address,uint256)': {}, 'bad key': {} },
      errors: { 'Not-Owner': {} },
    })
    expect(messages(issues)).toEqual([
      expect.stringContaining(
        'events key "bad key" is not a valid name, signature, or 32-byte topic hash',
      ),
      expect.stringContaining(
        'errors key "Not-Owner" is not a valid name, signature, or 4-byte selector',
      ),
    ])
  })

  it('flags truncated and uppercase hex keys in events and errors', () => {
    const topic = '0x' + 'ab'.repeat(32)
    const issues = semanticChecks({
      events: {
        [topic]: {},                    // valid 32-byte topic
        '0xddf252ad': {},               // truncated topic hash
        [topic.toUpperCase().replace('0X', '0x')]: {}, // uppercase hex
      },
      errors: {
        '0x08c379a0': {},               // valid 4-byte selector
        '0x08c3': {},                   // truncated selector
        '0x08C379A0': {},               // uppercase hex
        [topic]: {},                    // 32 bytes where 4 are required
      },
    })
    expect(messages(issues)).toEqual([
      expect.stringContaining('events key "0xddf252ad"'),
      expect.stringContaining(`events key "${topic.toUpperCase().replace('0X', '0x')}"`),
      expect.stringContaining('errors key "0x08c3"'),
      expect.stringContaining('errors key "0x08C379A0"'),
      expect.stringContaining(`errors key "${topic}"`),
    ])
  })

  it('accepts $ in bare names and signatures for events and errors', () => {
    const issues = semanticChecks({
      events: { $Custom: {}, '$emit(address)': {} },
      errors: { _$weird: {} },
    })
    expect(issues).toEqual([])
  })

  it('checks includes via the injected existence callback', () => {
    const issues = semanticChecks(
      { includes: ['interface:erc20', 'interface:erc9999', 'https://x.test/m.json'] },
      { interfaceExists: (name) => name === 'erc20' },
    )
    expect(messages(issues)).toEqual([
      'includes references unknown interface "interface:erc9999"',
    ])
  })

  it('checks the address against the expected one', () => {
    const doc = { address: '0xabc' }
    expect(semanticChecks(doc, { expectedAddress: '0xabc' })).toEqual([])
    expect(
      messages(semanticChecks(doc, { expectedAddress: '0xdef' })),
    ).toEqual(['address "0xabc" does not match expected "0xdef"'])
  })
})
