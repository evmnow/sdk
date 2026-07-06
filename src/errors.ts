export class ContractMetadataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContractMetadataError'
  }
}

export class ContractMetadataFetchError extends ContractMetadataError {
  source: string
  status: number

  constructor(source: string, status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContractMetadataFetchError'
    this.source = source
    this.status = status
  }
}

export type MetadataSource =
  | 'repository'
  | 'contractURI'
  | 'sourcify'
  | 'proxy'

export type ContractMetadataNotFoundReason =
  | 'not-verified'
  | 'not-published'
  | 'not-a-proxy'
  | 'source-disabled'
  | 'source-unavailable'
  | 'empty-response'

export interface ContractMetadataNotFoundOptions extends ErrorOptions {
  message?: string
  source?: MetadataSource
  reason?: ContractMetadataNotFoundReason
}

export class ContractMetadataNotFoundError extends ContractMetadataError {
  chainId: number
  address: string
  source?: MetadataSource
  reason?: ContractMetadataNotFoundReason

  constructor(
    chainId: number,
    address: string,
    options?: string | ContractMetadataNotFoundOptions,
  ) {
    const details = typeof options === 'string'
      ? { message: options }
      : options

    super(details?.message ?? `No metadata found for ${address} on chain ${chainId}`, details)
    this.name = 'ContractMetadataNotFoundError'
    this.chainId = chainId
    this.address = address
    this.source = details?.source
    this.reason = details?.reason
  }
}

export class ContractNotVerifiedOnSourcifyError extends ContractMetadataNotFoundError {
  constructor(chainId: number, address: string) {
    super(
      chainId,
      address,
      {
        source: 'sourcify',
        reason: 'not-verified',
        message: `No verified Sourcify metadata found for ${address} on chain ${chainId}`,
      },
    )
    this.name = 'ContractNotVerifiedOnSourcifyError'
  }
}

/** The input is not a valid EVM address (or fails its EIP-55 checksum). */
export class InvalidAddressError extends ContractMetadataError {
  /** The rejected input, verbatim. */
  input: string

  constructor(input: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Invalid address or ENS name: ${input}`, options)
    this.name = 'InvalidAddressError'
    this.input = input
  }
}

/** The configured RPC endpoint reports a different chain than `config.chainId`. */
export class ChainIdMismatchError extends ContractMetadataError {
  /** The chainId the client was configured with. */
  expected: number
  /** The chainId the RPC's `eth_chainId` actually returned. */
  actual: number

  constructor(expected: number, actual: number, options?: ErrorOptions) {
    super(
      `RPC chainId mismatch: config.chainId=${expected} but rpc returned ${actual}`,
      options,
    )
    this.name = 'ChainIdMismatchError'
    this.expected = expected
    this.actual = actual
  }
}

/** The client configuration is missing something an operation requires (e.g. `ensRpc`). */
export class ContractClientConfigError extends ContractMetadataError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContractClientConfigError'
  }
}

export class ENSResolutionError extends ContractMetadataError {
  ensName: string

  constructor(ensName: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Failed to resolve ENS name: ${ensName}`, options)
    this.name = 'ENSResolutionError'
    this.ensName = ensName
  }
}
