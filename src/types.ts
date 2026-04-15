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
  proxy?: boolean
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
  abiLayers?: ContractAbiLayer[]
  natspec?: NatSpec
  sources?: Record<string, string>
  deployedBytecode?: string
  proxy?: ProxyResolution
}

export interface NatSpec {
  userdoc?: Record<string, unknown>
  devdoc?: Record<string, unknown>
}

export type { ProxyPattern, ResolvedTarget, RawProxy } from '@1001-digital/proxies'

export type AbiLayerRole = 'main' | 'proxy-target' | 'facet'
export type AbiLayerCallMode = 'direct' | 'delegatecall-through-proxy'

export interface ContractAbiLayer {
  /** Where this ABI came from in relation to the requested contract. */
  role: AbiLayerRole
  /** Address whose verified artifact supplied this ABI. */
  address: string
  /** Address callers should use when invoking functions from this layer. */
  callAddress: string
  /** Whether calls execute directly or through a proxy fallback/delegatecall. */
  callMode: AbiLayerCallMode
  abi: unknown[]
  /** Defined for selector-scoped layers, currently diamond facets. */
  selectors?: string[]
  /** Proxy pattern that introduced this layer, when applicable. */
  pattern?: import('@1001-digital/proxies').ProxyPattern
}

/** An implementation target behind a proxy, enriched with ABI + NatSpec. */
export interface TargetInfo {
  address: string
  /** Defined for diamond facets; undefined for single-impl proxies (all selectors). */
  selectors?: string[]
  abi?: unknown[]
  natspec?: NatSpec
}

export interface ProxyResolution {
  /** Which proxy pattern was detected (diamond, 1967, beacon, …). */
  pattern: import('@1001-digital/proxies').ProxyPattern
  /** Resolved targets — one for every single-impl proxy pattern; N for diamonds. */
  targets: TargetInfo[]
  /** EIP-1967 beacon address (only for `eip-1967-beacon`). */
  beacon?: string
  /** EIP-1967 admin address (only for `eip-1967` when the admin slot is set). */
  admin?: string
  /** Composite ABI built from target ABIs (first-wins dedup by selector). */
  compositeAbi?: unknown[]
  /** Merged NatSpec across targets (first-target-wins per key). */
  natspec?: NatSpec
  /** Metadata layer (functions/events/errors) distilled from target NatSpec, ready to merge. */
  metadataLayer?: Partial<ContractMetadataDocument>
}

export interface FetchProxyOptions {
  /** Fetch Sourcify for each target to populate ABI + NatSpec. Default: true. */
  sourcify?: boolean
}

// ── Client ──

export interface ContractClient {
  get: (addressOrEns: string, options?: GetOptions) => Promise<ContractResult>
  fetchRepository: (address: string) => Promise<Partial<ContractMetadataDocument> | null>
  fetchContractURI: (address: string) => Promise<Partial<ContractMetadataDocument> | null>
  fetchSourcify: (address: string) => Promise<SourcifyResult | null>
  fetchProxy: (address: string, options?: FetchProxyOptions) => Promise<ProxyResolution | null>
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
