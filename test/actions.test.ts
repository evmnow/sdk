import { describe, it, expect } from 'vitest'
import { resolveActions } from '../src/actions'
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

  it('disambiguates overloads with name-types slug for synthesized defaults', () => {
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
      'transfer-address-uint256',
      'transfer-address-uint256-bytes',
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

  it('emits variant alongside default when authored id differs from canonical', () => {
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
    const { actions } = resolveActions([APPROVE_ABI], doc)
    expect(actions).toHaveLength(2)
    const ids = actions.map(a => a.id).sort()
    expect(ids).toEqual(['approve', 'revoke'])
    // Both share the same selector → both flagged as variants
    for (const a of actions) {
      expect(a.selector).toBe(APPROVE_SELECTOR)
      expect(a.isVariant).toBe(true)
    }
    const revoke = actions.find(a => a.id === 'revoke')!
    expect(revoke.synthesized).toBe(false)
    const defaultApprove = actions.find(a => a.id === 'approve')!
    expect(defaultApprove.synthesized).toBe(true)
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
      'transfer-address-uint256',
      'transfer-address-uint256-bytes',
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
})
