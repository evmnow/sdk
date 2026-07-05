import { describe, it, expect } from 'vitest'
import { createContractClient, detectInterfaces } from '../src/index'
import { createMockFetch } from './helpers/mock-fetch'

const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'

function fn(name: string, inputs: string[], outputs: string[] = []) {
  return {
    type: 'function',
    name,
    inputs: inputs.map(type => ({ type })),
    outputs: outputs.map(type => ({ type })),
  }
}

const ERC20_ABI = [
  fn('name', [], ['string']),
  fn('symbol', [], ['string']),
  fn('decimals', [], ['uint8']),
  fn('totalSupply', [], ['uint256']),
  fn('balanceOf', ['address'], ['uint256']),
  fn('transfer', ['address', 'uint256'], ['bool']),
  fn('transferFrom', ['address', 'address', 'uint256'], ['bool']),
  fn('approve', ['address', 'uint256'], ['bool']),
  fn('allowance', ['address', 'address'], ['uint256']),
]

const ERC721_ABI = [
  fn('balanceOf', ['address'], ['uint256']),
  fn('ownerOf', ['uint256'], ['address']),
  fn('safeTransferFrom', ['address', 'address', 'uint256', 'bytes']),
  fn('safeTransferFrom', ['address', 'address', 'uint256']),
  fn('transferFrom', ['address', 'address', 'uint256']),
  fn('approve', ['address', 'uint256']),
  fn('setApprovalForAll', ['address', 'bool']),
  fn('getApproved', ['uint256'], ['address']),
  fn('isApprovedForAll', ['address', 'address'], ['bool']),
]

function encodeAbiString(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return '0x'
    + '20'.padStart(64, '0')
    + bytes.length.toString(16).padStart(64, '0')
    + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
}

describe('detectInterfaces', () => {
  it('detects a full ERC-20 function set', () => {
    expect(detectInterfaces(ERC20_ABI)).toEqual(['erc20'])
  })

  it('detects a full ERC-721 function set', () => {
    expect(detectInterfaces(ERC721_ABI)).toEqual(['erc721'])
  })

  it('requires every mandatory function', () => {
    const partial = ERC20_ABI.filter(entry => entry.name !== 'allowance')
    expect(detectInterfaces(partial)).toEqual([])
    expect(detectInterfaces([])).toEqual([])
  })

  it('ignores optional extensions when matching', () => {
    const bare = ERC20_ABI.filter(
      entry => !['name', 'symbol', 'decimals'].includes(entry.name),
    )
    expect(detectInterfaces(bare)).toEqual(['erc20'])
  })

  it('prefers ERC-721 when both standards match', () => {
    expect(detectInterfaces([...ERC721_ABI, ...ERC20_ABI])).toEqual(['erc721'])
  })
})

describe('client.get standard-interface layer', () => {
  function daiMockFetch() {
    return createMockFetch([
      {
        match: url => url.includes('sourcify.dev'),
        response: { status: 200, body: { abi: ERC20_ABI } },
      },
      {
        match: (url, body) =>
          url.includes('rpc.test') && body.includes('0x06fdde03'),
        response: {
          status: 200,
          body: { jsonrpc: '2.0', id: 1, result: encodeAbiString('Dai Stablecoin') },
        },
      },
      {
        match: (url, body) =>
          url.includes('rpc.test') && body.includes('0x95d89b41'),
        response: {
          status: 200,
          body: { jsonrpc: '2.0', id: 1, result: encodeAbiString('DAI') },
        },
      },
    ])
  }

  it('applies the erc20 layer and on-chain identity without a curated doc', async () => {
    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: daiMockFetch(),
    })

    const result = await client.get(DAI)

    expect(result.interfaces).toEqual(['erc20'])
    expect(result.metadata.name).toBe('Dai Stablecoin')
    expect(result.metadata.symbol).toBe('DAI')
    expect(result.metadata.groups?.erc20).toBeTruthy()
    expect(result.metadata.actions?.balanceOf?.returns?._0?.type).toBe('token-amount')
    expect(result.metadata.actions?.transfer?.params?._1?.type).toBe('token-amount')
  })

  it('keeps curated layers authoritative over the interface layer', async () => {
    const fetchFn = createMockFetch([
      {
        match: url => url.includes('contract-metadata') && url.includes(DAI),
        response: {
          status: 200,
          body: {
            name: 'Curated Dai',
            actions: { balanceOf: { title: 'Curated Balance' } },
          },
        },
      },
      {
        match: url => url.includes('sourcify.dev'),
        response: { status: 200, body: { abi: ERC20_ABI } },
      },
      {
        match: (url, body) =>
          url.includes('rpc.test') && body.includes('0x95d89b41'),
        response: {
          status: 200,
          body: { jsonrpc: '2.0', id: 1, result: encodeAbiString('DAI') },
        },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: fetchFn,
    })

    const result = await client.get(DAI)

    expect(result.metadata.name).toBe('Curated Dai')
    expect(result.metadata.actions?.balanceOf?.title).toBe('Curated Balance')
    // Non-curated actions still come from the interface layer,
    // and the missing symbol is filled from chain.
    expect(result.metadata.actions?.transfer?.params?._1?.type).toBe('token-amount')
    expect(result.metadata.symbol).toBe('DAI')
  })

  it('does nothing for non-token ABIs', async () => {
    const fetchFn = createMockFetch([
      {
        match: url => url.includes('sourcify.dev'),
        response: {
          status: 200,
          body: { abi: [fn('deposit', []), fn('withdraw', ['uint256'])] },
        },
      },
    ])

    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: fetchFn,
    })

    const result = await client.get(DAI)

    expect(result.interfaces).toBeUndefined()
    expect(result.metadata.groups?.erc20).toBeUndefined()
  })

  it('can be disabled via sources.interfaces', async () => {
    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: daiMockFetch(),
    })

    const result = await client.get(DAI, { sources: { interfaces: false } })

    expect(result.interfaces).toBeUndefined()
    expect(result.metadata.name).toBeUndefined()
    expect(result.metadata.actions?.balanceOf?.returns).toBeUndefined()
  })

  it('survives rpc failures during the identity fill', async () => {
    const fetchFn = createMockFetch([
      {
        match: url => url.includes('sourcify.dev'),
        response: { status: 200, body: { abi: ERC20_ABI } },
      },
      // name()/symbol() calls fall through to the mock's 404 default.
    ])

    const client = createContractClient({
      chainId: 1,
      rpc: 'https://rpc.test',
      fetch: fetchFn,
    })

    const result = await client.get(DAI)

    expect(result.interfaces).toEqual(['erc20'])
    expect(result.metadata.name).toBeUndefined()
    expect(result.metadata.actions?.balanceOf?.returns?._0?.type).toBe('token-amount')
  })
})
