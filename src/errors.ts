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

export class ContractMetadataNotFoundError extends ContractMetadataError {
  chainId: number
  address: string

  constructor(chainId: number, address: string) {
    super(`No metadata found for ${address} on chain ${chainId}`)
    this.name = 'ContractMetadataNotFoundError'
    this.chainId = chainId
    this.address = address
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
