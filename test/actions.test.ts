import { describe, it, expect } from 'vitest'
import { resolveActions, matchAction } from '../src/actions'
import type { ContractMetadataDocument } from '../src/types'

const APPROVE_ABI = {
  type: 'function',
  name: 'approve',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ type: 'bool' }],
  stateMutability: 'nonpayable',
}

const TRANSFER_ABI = {
  type: 'function',
  name: 'transfer',
  inputs: [
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ type: 'bool' }],
  stateMutability: 'nonpayable',
}

const BALANCE_OF_ABI = {
  type: 'function',
  name: 'balanceOf',
  inputs: [{ name: 'owner', type: 'address' }],
  outputs: [{ type: 'uint256' }],
  stateMutability: 'view',
}

const MINT_ABI = {
  type: 'function',
  name: 'mint',
  inputs: [{ name: 'amount', type: 'uint256' }],
  outputs: [],
  stateMutability: 'payable',
}

// approve(address,uint256) selector
const APPROVE_SELECTOR = '0x095ea7b3'

describe('resolveActions', () => {
  it('synthesizes a default action for every ABI function when no metadata', () => {
    const { actions, issues } = resolveActions([APPROVE_ABI, TRANSFER_ABI, BALANCE_OF_ABI], {})
    expect(issues).toHaveLength(0)
    expect(actions).toHaveLength(3)
    expect(actions.map(a => a.id).sort()).toEqual(['approve', 'balanceOf', 'transfer'])
    for (const a of actions) {
      expect(a.synthesized).toBe(true)
      expect(a.isVariant).toBe(false)
      expect(a.meta.function).toBe(a.abi.name)
    }
  })

  it('disambiguates overloaded synthesized defaults with the canonical signature as id', () => {
    const abi = [
      {
        type: 'function',
        name: 'transfer',
        inputs: [{ type: 'address' }, { type: 'uint256' }],
      },
      {
        type: 'function',
        name: 'transfer',
        inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      },
    ]
    const { actions } = resolveActions(abi, {})
    expect(actions.map(a => a.id).sort()).toEqual([
      'transfer(address,uint256)',
      'transfer(address,uint256,bytes)',
    ])
  })

  it('merges authored action with matching id into default (suppresses synthesis)', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          function: 'approve',
          title: 'Approve',
          description: 'Approve tokens',
        },
      },
    }
    const { actions } = resolveActions([APPROVE_ABI], doc)
    expect(actions).toHaveLength(1)
    expect(actions[0].synthesized).toBe(false)
    expect(actions[0].meta.title).toBe('Approve')
  })

  it('any authored action suppresses the synthesized default for its function', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        revoke: {
          function: 'approve',
          title: 'Revoke Approval',
          params: {
            amount: {
              autofill: { type: 'constant', value: '0' },
              hidden: true,
            },
          },
        },
      },
    }
    // The authored variant is approve's complete representation — no default
    // is synthesized alongside it. Authors wanting a generic form author a
    // base action explicitly.
    const { actions } = resolveActions([APPROVE_ABI], doc)
    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe('revoke')
    expect(actions[0].synthesized).toBe(false)
    expect(actions[0].isVariant).toBe(false)
  })

  it('flags authored base action and variants on the same function as variants', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          title: 'Approve',
        },
        revoke: {
          function: 'approve',
          title: 'Revoke Approval',
          params: {
            amount: {
              autofill: { type: 'constant', value: '0' },
              hidden: true,
            },
          },
        },
      },
    }
    const { actions } = resolveActions([APPROVE_ABI], doc)
    expect(actions).toHaveLength(2)
    expect(actions.map(a => a.id).sort()).toEqual(['approve', 'revoke'])
    for (const a of actions) {
      expect(a.selector).toBe(APPROVE_SELECTOR)
      expect(a.isVariant).toBe(true)
      expect(a.synthesized).toBe(false)
    }
  })

  it('a hidden authored action still suppresses the default (function fully hidden)', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: { hidden: true },
      },
    }
    const { actions, issues } = resolveActions([APPROVE_ABI, TRANSFER_ABI], doc)
    expect(issues).toHaveLength(0)
    const approve = actions.filter(a => a.selector === APPROVE_SELECTOR)
    expect(approve).toHaveLength(1)
    expect(approve[0].synthesized).toBe(false)
    expect(approve[0].meta.hidden).toBe(true)
    // transfer is untouched → still synthesized
    expect(actions.find(a => a.id === 'transfer')?.synthesized).toBe(true)
  })

  it('resolves authored action by canonical signature', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          function: 'approve(address,uint256)',
          title: 'Approve by signature',
        },
      },
    }
    const { actions, issues } = resolveActions([APPROVE_ABI], doc)
    expect(issues).toHaveLength(0)
    expect(actions).toHaveLength(1)
    expect(actions[0].meta.title).toBe('Approve by signature')
  })

  it('resolves authored action by 4-byte selector', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          function: APPROVE_SELECTOR,
          title: 'Approve by selector',
        },
      },
    }
    const { actions, issues } = resolveActions([APPROVE_ABI], doc)
    expect(issues).toHaveLength(0)
    expect(actions).toHaveLength(1)
    expect(actions[0].meta.title).toBe('Approve by selector')
  })

  it('emits ambiguous-overload issue for bare name referencing overloaded function', () => {
    const abi = [
      { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }] },
      { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }] },
    ]
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        myTransfer: { function: 'transfer', title: 'Ambiguous' },
      },
    }
    const { actions, issues } = resolveActions(abi, doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('ambiguous-overload')
    expect(issues[0].id).toBe('myTransfer')
    // The variant is skipped; synthesized defaults still render for both overloads
    expect(actions.map(a => a.id).sort()).toEqual([
      'transfer(address,uint256)',
      'transfer(address,uint256,bytes)',
    ])
  })

  it('emits unresolved-function issue when ref does not match ABI', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        ghost: { function: 'nonexistent', title: 'Ghost' },
      },
    }
    const { actions, issues } = resolveActions([APPROVE_ABI], doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('unresolved-function')
    expect(issues[0].id).toBe('ghost')
    // Unresolved action is skipped; synthesized default still renders
    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe('approve')
  })

  it('emits hidden-without-autofill issue', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        broken: {
          function: 'approve',
          params: { amount: { hidden: true } },
        },
      },
    }
    const { issues } = resolveActions([APPROVE_ABI], doc)
    const hiddenIssue = issues.find(i => i.code === 'hidden-without-autofill')
    expect(hiddenIssue).toBeTruthy()
    expect(hiddenIssue!.id).toBe('broken')
  })

  it('emits disabled-without-autofill issue', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        broken: {
          function: 'approve',
          params: { amount: { disabled: true } },
        },
      },
    }
    const { issues } = resolveActions([APPROVE_ABI], doc)
    const issue = issues.find(i => i.code === 'disabled-without-autofill')
    expect(issue).toBeTruthy()
  })

  it('emits hidden-and-disabled issue when both are set', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        conflict: {
          function: 'approve',
          params: {
            amount: {
              autofill: { type: 'constant', value: '0' },
              hidden: true,
              disabled: true,
            },
          },
        },
      },
    }
    const { issues } = resolveActions([APPROVE_ABI], doc)
    const issue = issues.find(i => i.code === 'hidden-and-disabled')
    expect(issue).toBeTruthy()
  })

  it('emits unknown-related issue when related references a missing action id', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          function: 'approve',
          related: ['does-not-exist'],
        },
      },
    }
    const { issues } = resolveActions([APPROVE_ABI], doc)
    const issue = issues.find(i => i.code === 'unknown-related')
    expect(issue).toBeTruthy()
    expect(issue!.id).toBe('approve')
  })

  it('computes correct selector and signature for synthesized defaults', () => {
    const { actions } = resolveActions([APPROVE_ABI], {})
    expect(actions).toHaveLength(1)
    expect(actions[0].selector).toBe(APPROVE_SELECTOR)
    expect(actions[0].signature).toBe('approve(address,uint256)')
  })

  it('falls back to action id when `function` is omitted', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          title: 'Approve (no function field)',
          description: 'Implicit 1:1 mapping via id',
        },
      },
    }
    const { actions, issues } = resolveActions([APPROVE_ABI], doc)
    expect(issues).toHaveLength(0)
    expect(actions).toHaveLength(1)
    expect(actions[0].synthesized).toBe(false)
    expect(actions[0].meta.title).toBe('Approve (no function field)')
    expect(actions[0].selector).toBe(APPROVE_SELECTOR)
  })

  it('omitted function + unknown id → unresolved-function', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        notAFunction: {
          title: 'Mystery',
        },
      },
    }
    const { actions, issues } = resolveActions([APPROVE_ABI], doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('unresolved-function')
    // Synthesized default for approve still present
    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe('approve')
  })

  it('emits unknown-related when related points at a synthesized default', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          // transfer resolves as a synthesized default, but synthesized
          // defaults are consumer-internal — not valid cross-reference targets
          related: ['transfer'],
        },
      },
    }
    const { issues } = resolveActions([APPROVE_ABI, TRANSFER_ABI], doc)
    const issue = issues.find(i => i.code === 'unknown-related')
    expect(issue).toBeTruthy()
    expect(issue!.id).toBe('approve')
  })

  it('accepts value metadata on a payable function', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        mint: {
          title: 'Mint (0.01 ETH)',
          value: {
            autofill: { type: 'constant', value: '10000000000000000' },
            disabled: true,
          },
        },
      },
    }
    const { issues } = resolveActions([MINT_ABI], doc)
    expect(issues).toHaveLength(0)
  })

  it('emits value-on-nonpayable when value metadata targets a nonpayable function', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        approve: {
          value: { label: 'Amount' },
        },
      },
    }
    const { issues } = resolveActions([APPROVE_ABI], doc)
    const issue = issues.find(i => i.code === 'value-on-nonpayable')
    expect(issue).toBeTruthy()
    expect(issue!.id).toBe('approve')
  })

  it('respects a stateMutability override when checking value metadata', () => {
    const legacyAbi = [{ ...MINT_ABI, stateMutability: undefined }]
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        mint: {
          stateMutability: 'payable',
          value: { label: 'Price' },
        },
      },
    }
    const { issues } = resolveActions(legacyAbi, doc)
    expect(issues).toHaveLength(0)
  })

  it('applies lock-flag checks to value metadata', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        mint: {
          value: { hidden: true },
        },
      },
    }
    const { issues } = resolveActions([MINT_ABI], doc)
    const issue = issues.find(i => i.code === 'hidden-without-autofill')
    expect(issue).toBeTruthy()
    expect(issue!.message).toContain('value')
  })
})

describe('matchAction', () => {
  const ERC20_DOC: Partial<ContractMetadataDocument> = {
    actions: {
      approve: {
        title: 'Approve',
      },
      revoke: {
        function: 'approve',
        title: 'Revoke Approval',
        params: {
          amount: {
            autofill: { type: 'constant', value: '0' },
            hidden: true,
          },
        },
      },
      'approve-max': {
        function: 'approve',
        title: 'Approve Unlimited',
        params: {
          amount: {
            autofill: {
              type: 'constant',
              value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
            },
            hidden: true,
          },
        },
      },
    },
  }

  const SPENDER = '0x1111111111111111111111111111111111111111'

  it('selects the variant whose locked constant matches the decoded argument', () => {
    const { actions } = resolveActions([APPROVE_ABI], ERC20_DOC)
    const match = matchAction(actions, {
      selector: APPROVE_SELECTOR,
      args: { spender: SPENDER, amount: 0n },
    })
    expect(match?.id).toBe('revoke')
  })

  it('falls back to the base action when no variant constraint matches', () => {
    const { actions } = resolveActions([APPROVE_ABI], ERC20_DOC)
    const match = matchAction(actions, {
      selector: APPROVE_SELECTOR,
      args: { spender: SPENDER, amount: 1000n },
    })
    expect(match?.id).toBe('approve')
  })

  it('compares hex and decimal representations numerically', () => {
    const { actions } = resolveActions([APPROVE_ABI], ERC20_DOC)
    const match = matchAction(actions, {
      selector: APPROVE_SELECTOR,
      args: {
        spender: SPENDER,
        amount: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
    })
    expect(match?.id).toBe('approve-max')
  })

  it('discards variants when decoded args are unavailable — base wins', () => {
    const { actions } = resolveActions([APPROVE_ABI], ERC20_DOC)
    const match = matchAction(actions, { selector: APPROVE_SELECTOR })
    expect(match?.id).toBe('approve')
  })

  it('returns a synthesized default when every candidate fails its constraints', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        revoke: {
          function: 'approve',
          params: {
            amount: { autofill: { type: 'constant', value: '0' }, hidden: true },
          },
        },
      },
    }
    const { actions } = resolveActions([APPROVE_ABI], doc)
    expect(actions).toHaveLength(1)
    const match = matchAction(actions, {
      selector: APPROVE_SELECTOR,
      args: { spender: SPENDER, amount: 42n },
    })
    expect(match?.synthesized).toBe(true)
    expect(match?.id).toBe('approve')
  })

  it('returns null when no action matches the selector', () => {
    const { actions } = resolveActions([APPROVE_ABI], ERC20_DOC)
    expect(matchAction(actions, { selector: '0xdeadbeef' })).toBeNull()
  })

  it('evaluates zero-address and connected-address constraints from context', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        transfer: { title: 'Transfer' },
        'transfer-to-self': {
          function: 'transfer',
          params: {
            recipient: { autofill: 'connected-address', hidden: true },
          },
        },
        burn: {
          function: 'transfer',
          params: {
            recipient: { autofill: 'zero-address', hidden: true },
          },
        },
      },
    }
    const { actions } = resolveActions([TRANSFER_ABI], doc)
    const selector = actions[0].selector

    const burn = matchAction(actions, {
      selector,
      args: { recipient: '0x0000000000000000000000000000000000000000', amount: 1n },
    })
    expect(burn?.id).toBe('burn')

    const toSelf = matchAction(actions, {
      selector,
      args: { recipient: SPENDER, amount: 1n },
      sender: SPENDER,
    })
    expect(toSelf?.id).toBe('transfer-to-self')

    // Without sender context, connected-address is not knowable — the
    // variant carries no constraint and the base action wins on tie-breaks
    // only if ids order it first; here the unconstrained variant ties with
    // base at 0 locks, and "burn" fails → lexicographic id decides.
    const noContext = matchAction(actions, {
      selector,
      args: { recipient: SPENDER, amount: 1n },
    })
    expect(noContext?.id).toBe('transfer')
  })

  it('treats block-timestamp autofill as unconstrained', () => {
    const abi = [{
      type: 'function',
      name: 'setDeadline',
      inputs: [{ name: 'deadline', type: 'uint256' }],
      outputs: [],
      stateMutability: 'nonpayable',
    }]
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        setDeadline: {
          params: {
            deadline: { autofill: 'block-timestamp', hidden: true },
          },
        },
      },
    }
    const { actions } = resolveActions(abi, doc)
    const match = matchAction(actions, {
      selector: actions[0].selector,
      args: { deadline: 1234567890n },
    })
    expect(match?.id).toBe('setDeadline')
  })

  it('constrains the transaction value for a locked value object', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        mint: { title: 'Mint' },
        'mint-fixed': {
          function: 'mint',
          title: 'Mint (0.01 ETH)',
          value: {
            autofill: { type: 'constant', value: '10000000000000000' },
            disabled: true,
          },
        },
      },
    }
    const { actions } = resolveActions([MINT_ABI], doc)
    const selector = actions[0].selector

    const fixed = matchAction(actions, {
      selector,
      args: { amount: 1n },
      value: 10000000000000000n,
    })
    expect(fixed?.id).toBe('mint-fixed')

    const other = matchAction(actions, {
      selector,
      args: { amount: 1n },
      value: 5n,
    })
    expect(other?.id).toBe('mint')
  })

  it('breaks ties by lowest order, then lexicographically smallest id', () => {
    const doc: Partial<ContractMetadataDocument> = {
      actions: {
        'b-approve': { function: 'approve', order: 1 },
        'a-approve': { function: 'approve', order: 2 },
        'c-approve': { function: 'approve', order: 1 },
      },
    }
    const { actions } = resolveActions([APPROVE_ABI], doc)
    const match = matchAction(actions, {
      selector: APPROVE_SELECTOR,
      args: { spender: SPENDER, amount: 5n },
    })
    // order 1 beats order 2; "b-approve" < "c-approve"
    expect(match?.id).toBe('b-approve')
  })
})
