// ── Schema-aligned types ──

export interface ContractMetadataDocument {
  $schema?: string
  chainId: number
  address: string
  includes?: string[]
  meta?: DocumentMeta
  name?: string
  symbol?: string
  description?: string
  image?: string
  banner_image?: string
  featured_image?: string
  external_link?: string
  collaborators?: string[]
  about?: string
  category?: string
  tags?: string[]
  links?: Link[]
  risks?: string[]
  audits?: AuditReference[]
  theme?: Theme
  groups?: Record<string, Group>
  functions?: Record<string, FunctionMeta>
  events?: Record<string, EventMeta>
  errors?: Record<string, ErrorMeta>
  messages?: Record<string, MessageMeta>
  [key: `_${string}`]: unknown
}

export interface DocumentMeta {
  version?: number
  lastUpdated?: string
  locale?: string
  signature?: string
}

export interface Theme {
  background?: string
  text?: string
  accent?: string
  accentText?: string
  border?: string
}

export interface Link {
  label: string
  url: string
}

export interface AuditReference {
  auditor: string
  url: string
  date: string
  scope?: string
}

export interface Group {
  label: string
  description?: string
  order: number
}

export interface FunctionMeta {
  order?: number
  title?: string
  description?: string
  intent?: string
  group?: string
  warning?: string
  featured?: boolean
  hidden?: boolean
  stateMutability?: 'view' | 'pure' | 'nonpayable' | 'payable'
  params?: Record<string, ParamMeta>
  returns?: Record<string, ParamMeta>
  examples?: FunctionExample[]
  related?: string[]
  deprecated?: string
  [key: `_${string}`]: unknown
}

export interface EventMeta {
  order?: number
  title?: string
  description?: string
  params?: Record<string, ParamMeta>
  [key: `_${string}`]: unknown
}

export interface ErrorMeta {
  order?: number
  title?: string
  description?: string
  params?: Record<string, ParamMeta>
  [key: `_${string}`]: unknown
}

export interface MessageMeta {
  order?: number
  title?: string
  description?: string
  intent?: string
  warning?: string
  fields?: Record<string, ParamMeta>
  [key: `_${string}`]: unknown
}

export interface ParamMeta {
  label?: string
  description?: string
  type?: ParamType
  autofill?: Autofill
  validation?: ValidationRule
  preview?: ParamPreview
  [key: `_${string}`]: unknown
}

export type ParamType =
  | 'eth' | 'gwei' | 'timestamp' | 'address' | 'boolean'
  | 'blocknumber' | 'duration' | 'bytes32-utf8' | 'token-id'
  | 'percentage' | 'basis-points' | 'token-amount' | 'date'
  | 'datetime' | 'hidden'
  | AddressType
  | TokenAmountType
  | TokenIdType
  | EnumType
  | SliderType

export interface AddressType {
  type: 'address'
  ens?: boolean
  addressBook?: boolean
}

export interface TokenAmountType {
  type: 'token-amount'
  tokenAddress: string
}

export interface TokenIdType {
  type: 'token-id'
  tokenAddress: string
}

export interface EnumType {
  type: 'enum'
  values: Record<string, string>
}

export interface SliderType {
  type: 'slider'
  min: string
  max: string
  step?: string
}

export type Autofill =
  | 'connected-address' | 'contract-address' | 'zero-address' | 'block-timestamp'
  | { type: 'constant'; value: string }

export interface ValidationRule {
  min?: string
  max?: string
  enum?: { value: string; label: string }[]
  pattern?: string
  message?: string
}

export interface ParamPreview {
  image?: string
}

export interface FunctionExample {
  label: string
  params: Record<string, string>
}

// ── Configuration ──

export interface SourceConfig {
  repository?: boolean
  contractURI?: boolean
  sourcify?: boolean
  diamond?: boolean
}

export interface IncludeFields {
  sources?: boolean
  deployedBytecode?: boolean
}

export interface ContractClientConfig {
  chainId: number
  rpc?: string
  /**
   * Ethereum mainnet RPC used exclusively for ENS resolution. Required when
   * `chainId !== 1` and callers may pass `.eth` names. Defaults to `rpc`
   * when `chainId === 1`.
   */
  ensRpc?: string
  repositoryUrl?: string
  sourcifyUrl?: string
  ipfsGateway?: string
  fetch?: typeof globalThis.fetch
  sources?: SourceConfig
  include?: IncludeFields
}

export interface GetOptions {
  sources?: SourceConfig
  include?: IncludeFields
}

// ── Result ──

export interface ContractResult {
  chainId: number
  address: string
  metadata: ContractMetadataDocument
  abi?: unknown[]
  natspec?: NatSpec
  sources?: Record<string, string>
  deployedBytecode?: string
  facets?: FacetInfo[]
}

export interface NatSpec {
  userdoc?: Record<string, unknown>
  devdoc?: Record<string, unknown>
}

export interface FacetInfo {
  address: string
  selectors: string[]
  abi?: unknown[]
  natspec?: NatSpec
}

/** Raw on-chain facets() result: address + selectors per facet, no ABI. */
export interface RawFacet {
  facetAddress: string
  functionSelectors: string[]
}

export interface DiamondResolution {
  /** All live facets (zero-address entries filtered out). */
  facets: FacetInfo[]
  /** Composite ABI built from facet ABIs (first-wins dedup by selector). */
  compositeAbi?: unknown[]
  /** Merged NatSpec across facets (first-facet-wins per key). */
  natspec?: NatSpec
  /** Metadata layer (functions/events/errors) distilled from facet NatSpec, ready to merge. */
  metadataLayer?: Partial<ContractMetadataDocument>
}

export interface FetchDiamondOptions {
  /** Fetch Sourcify for each facet to populate ABI + NatSpec. Default: true. */
  sourcify?: boolean
}

// ── Client ──

export interface ContractClient {
  get: (addressOrEns: string, options?: GetOptions) => Promise<ContractResult>
  fetchRepository: (address: string) => Promise<Partial<ContractMetadataDocument> | null>
  fetchContractURI: (address: string) => Promise<Partial<ContractMetadataDocument> | null>
  fetchSourcify: (address: string) => Promise<SourcifyResult | null>
  fetchDiamond: (address: string, options?: FetchDiamondOptions) => Promise<DiamondResolution | null>
}

export interface SourcifyResult {
  abi?: unknown[]
  userdoc?: Record<string, unknown>
  devdoc?: Record<string, unknown>
  sources?: Record<string, string>
  deployedBytecode?: string
  functions?: Record<string, FunctionMeta>
  events?: Record<string, EventMeta>
  errors?: Record<string, ErrorMeta>
}
