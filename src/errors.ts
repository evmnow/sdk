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

export class ENSResolutionError extends ContractMetadataError {
  ensName: string

  constructor(ensName: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Failed to resolve ENS name: ${ensName}`, options)
    this.name = 'ENSResolutionError'
    this.ensName = ensName
  }
}
