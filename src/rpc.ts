import { ContractMetadataFetchError, ENSResolutionError } from './errors'
import { namehash, dnsEncode } from './ens'

// ENS Universal Resolver on Ethereum mainnet. Resolution only works when
// `resolveEns` is called with a mainnet RPC — see `ensRpc` in
// `ContractClientConfig`.
const UNIVERSAL_RESOLVER = '0xce01f8eee7E479C928F8919abD53E553a36CeF67'

// Precomputed function selectors
export const CONTRACT_URI_SELECTOR = '0xe8a3d485'  // contractURI()
const RESOLVE_SELECTOR = '0x9061b923'               // resolve(bytes,bytes)
const ADDR_SELECTOR = '0x3b3b57de'                   // addr(bytes32)

const decoder = new TextDecoder()

async function jsonRpcCall(
  rpc: string,
  method: string,
  params: unknown[],
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const res = await fetchFn(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  if (!res.ok) {
    throw new ContractMetadataFetchError('rpc', res.status, `RPC request failed: ${res.status}`)
  }

  const json = await res.json() as { result?: string; error?: { message: string } }

  if (json.error) {
    throw new ContractMetadataFetchError('rpc', 0, `RPC error: ${json.error.message}`)
  }

  return json.result
}

export async function getChainId(rpc: string, fetchFn: typeof fetch): Promise<number> {
  const result = await jsonRpcCall(rpc, 'eth_chainId', [], fetchFn)
  if (typeof result !== 'string') {
    throw new ContractMetadataFetchError('rpc', 0, 'RPC eth_chainId returned no result')
  }
  return parseInt(result, 16)
}

export async function ethCall(
  rpc: string,
  to: string,
  data: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const result = await jsonRpcCall(rpc, 'eth_call', [{ to, data }, 'latest'], fetchFn)
  return result ?? '0x'
}

export async function resolveEns(
  rpc: string,
  name: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const node = namehash(name)
  const dnsName = dnsEncode(name)
  const addrCalldata = ADDR_SELECTOR + node.slice(2)

  const dnsNameBytes = hexToBytes(dnsName)
  const addrCalldataBytes = hexToBytes(addrCalldata)

  const data = RESOLVE_SELECTOR + abiEncodeBytes2(dnsNameBytes, addrCalldataBytes)

  const result = await ethCall(rpc, UNIVERSAL_RESOLVER, data, fetchFn)

  if (result === '0x' || result.length < 130) {
    throw new ENSResolutionError(name)
  }

  const responseBytes = abiDecodeFirstBytes(result)

  if (responseBytes.length < 64) {
    throw new ENSResolutionError(name)
  }

  const addr = '0x' + responseBytes.slice(24, 64)

  if (addr === '0x' + '0'.repeat(40)) {
    throw new ENSResolutionError(name, `ENS name ${name} has no address record`)
  }

  return addr
}

export function decodeAbiString(data: string): string {
  const hex = data.startsWith('0x') ? data.slice(2) : data
  if (hex.length < 128) return ''

  // First 32 bytes: offset to string data
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  // Next 32 bytes at offset: string length
  const length = parseInt(hex.slice(offset, offset + 64), 16)
  // String data follows
  const strHex = hex.slice(offset + 64, offset + 64 + length * 2)

  return hexToUtf8(strHex)
}

function abiEncodeBytes2(a: Uint8Array, b: Uint8Array): string {
  const aLen = a.length
  const bLen = b.length
  const aPadded = Math.ceil(aLen / 32) * 32
  const bPadded = Math.ceil(bLen / 32) * 32

  // Offset of first bytes
  const offset1 = 64 // 0x40
  // Offset of second bytes
  const offset2 = offset1 + 32 + aPadded

  let hex = ''
  hex += pad32(offset1)
  hex += pad32(offset2)
  hex += pad32(aLen)
  hex += bytesToHex(a).padEnd(aPadded * 2, '0')
  hex += pad32(bLen)
  hex += bytesToHex(b).padEnd(bPadded * 2, '0')

  return hex
}

function abiDecodeFirstBytes(data: string): string {
  const hex = data.startsWith('0x') ? data.slice(2) : data
  // First 32 bytes: offset to first dynamic param
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  // At offset: length of bytes
  const length = parseInt(hex.slice(offset, offset + 64), 16)
  // Bytes data
  return hex.slice(offset + 64, offset + 64 + length * 2)
}

function pad32(n: number): string {
  return n.toString(16).padStart(64, '0')
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function hexToUtf8(hex: string): string {
  return decoder.decode(hexToBytes(hex))
}
