import { keccak_256 } from '@noble/hashes/sha3'

const encoder = new TextEncoder()

export function namehash(name: string): string {
  let node = new Uint8Array(32) // 0x00..00

  if (name === '') return toHex(node)

  const labels = name.split('.')
  const combined = new Uint8Array(64)
  for (let i = labels.length - 1; i >= 0; i--) {
    combined.set(node, 0)
    combined.set(new Uint8Array(keccak_256(encoder.encode(labels[i]))), 32)
    node = new Uint8Array(keccak_256(combined))
  }

  return toHex(node)
}

export function dnsEncode(name: string): string {
  const labels = name.split('.')
  let hex = ''

  for (const label of labels) {
    const bytes = encoder.encode(label)
    hex += padByte(bytes.length)
    for (const b of bytes) hex += padByte(b)
  }
  hex += '00' // null terminator

  return '0x' + hex
}

function toHex(bytes: Uint8Array): string {
  let hex = '0x'
  for (const b of bytes) hex += padByte(b)
  return hex
}

function padByte(n: number): string {
  return n.toString(16).padStart(2, '0')
}
