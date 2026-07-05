import { canonicalSignature } from '@1001-digital/proxies'
import type { ContractMetadataDocument, StandardInterface } from '../types'
import { erc20Interface } from './erc20'
import { erc721Interface } from './erc721'

/** Bundled metadata layers by standard, for callers composing manually. */
export const interfaceDocuments: Record<
  StandardInterface,
  Partial<ContractMetadataDocument>
> = {
  erc20: erc20Interface,
  erc721: erc721Interface,
}

// The mandatory function set of each standard. Optional extensions
// (name/symbol/decimals, ERC-721 enumeration) are deliberately excluded so
// detection doesn't miss spec-compliant contracts that skip them.
const ERC20_SIGNATURES = [
  'totalSupply()',
  'balanceOf(address)',
  'transfer(address,uint256)',
  'transferFrom(address,address,uint256)',
  'approve(address,uint256)',
  'allowance(address,address)',
]

const ERC721_SIGNATURES = [
  'balanceOf(address)',
  'ownerOf(uint256)',
  'safeTransferFrom(address,address,uint256,bytes)',
  'safeTransferFrom(address,address,uint256)',
  'transferFrom(address,address,uint256)',
  'approve(address,uint256)',
  'setApprovalForAll(address,bool)',
  'getApproved(uint256)',
  'isApprovedForAll(address,address)',
]

/**
 * Detect which token standards a contract implements from its ABI alone —
 * run it on the final ABI (after proxy composition), since proxies expose
 * the standard's functions only through their implementation.
 *
 * A standard matches when every mandatory function of its interface is
 * present. ERC-721 shadows ERC-20 (their signatures overlap on
 * `balanceOf`/`approve`/`transferFrom`, but an ERC-721 `balanceOf` counts
 * tokens — treating it as an ERC-20 amount would misformat it).
 */
export function detectInterfaces(abi: readonly unknown[]): StandardInterface[] {
  const signatures = new Set<string>()
  for (const entry of abi) {
    if (
      typeof entry === 'object' && entry !== null &&
      (entry as { type?: unknown }).type === 'function'
    ) {
      signatures.add(canonicalSignature(entry as Parameters<typeof canonicalSignature>[0]))
    }
  }

  if (ERC721_SIGNATURES.every(sig => signatures.has(sig))) return ['erc721']
  if (ERC20_SIGNATURES.every(sig => signatures.has(sig))) return ['erc20']
  return []
}
