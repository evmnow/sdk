# @evmnow/sdk

Resolve complete contract metadata for any EVM contract from multiple sources — curated repository, on-chain `contractURI` (ERC-7572), Sourcify + NatSpec, and ERC-2535 diamond facets — merged into a single document.

## Install

```
npm install @evmnow/sdk
```

## Quick start

```ts
import { createContractClient } from '@evmnow/sdk'

const client = createContractClient({
  chainId: 1,
  rpc: 'https://eth.llamarpc.com',
})

const result = await client.get('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')

console.log(result.metadata.name)        // "Uniswap"
console.log(result.metadata.description) // ...
console.log(result.metadata.functions)   // { "delegate(address)": { title: "...", ... }, ... }
console.log(result.abi)                  // full ABI from Sourcify (composite for diamonds)
```

ENS names work too:

```ts
const result = await client.get('uniswap.eth')
```

## How it works

The SDK fetches metadata from four sources in parallel, then merges them with increasing priority:

| Priority | Source | What it provides |
|----------|--------|-----------------|
| Lowest | **Diamonds and proxy targets** | ERC-2535 facet and proxy implementation ABI + NatSpec, merged into a composite ABI and `result.proxy` |
| Low | **Sourcify** | ABI and function/event/error descriptions from NatSpec comments |
| Medium | **contractURI** | On-chain ERC-7572 fields: name, symbol, description, image, links |
| Highest | **Repository** | Curated JSON from the [evmnow/contract-metadata](https://github.com/evmnow/contract-metadata) repo — full control over every field |

Higher-priority sources override lower ones. Record sections (`functions`, `events`, `errors`, `messages`, `groups`) are shallow-merged per key, so a repository entry can add a `title` to a function while keeping the NatSpec `description` from Sourcify.

## Configuration

```ts
const client = createContractClient({
  // Required
  chainId: 1,

  // Optional
  rpc: 'https://eth.llamarpc.com',        // needed for contractURI, diamonds/proxies, ENS on mainnet
  ensRpc: 'https://eth.llamarpc.com',     // mainnet RPC for ENS when chainId !== 1
  repositoryUrl: '...',                   // custom metadata repo base URL
  sourcifyUrl: 'https://sourcify.dev/server',
  ipfsGateway: 'https://ipfs.io',
  fetch: customFetch,                     // custom fetch implementation

  // Disable specific sources globally
  sources: {
    repository: true,   // default: true
    contractURI: true,  // default: true (requires rpc)
    sourcify: true,     // default: true
    proxy: true,        // default: true (requires rpc; detects ERC-2535 diamonds and proxies)
  },

  // Opt-in fields that aren't included by default
  include: {
    sources: false,           // verified source files from Sourcify, including proxy targets
    deployedBytecode: false,  // deployed bytecode from Sourcify
  },
})
```

ENS resolution only works on Ethereum mainnet. If `chainId === 1`, `rpc` is reused for ENS; otherwise set `ensRpc` explicitly to enable `.eth` name lookups.

The SDK performs a one-time consistency check that `config.chainId` matches the RPC's `eth_chainId`, the first time an RPC-dependent method runs.

## API

### `createContractClient(config)` → `ContractClient`

Creates a client bound to a specific chain.

### `client.get(addressOrEns, options?)` → `ContractResult`

Fetches and merges metadata from all enabled sources. Accepts a `0x` address or `.eth` ENS name (requires mainnet RPC via `rpc` or `ensRpc`).

Returns a `ContractResult`:

```ts
interface ContractResult {
  chainId: number
  address: string
  metadata: ContractMetadataDocument  // merged metadata from all sources
  abi?: unknown[]                     // ABI from Sourcify (composite for diamonds)
  natspec?: NatSpec                   // raw userdoc/devdoc (merged across facets)
  sources?: Record<string, string>    // verified source files (requires include.sources)
  deployedBytecode?: string           // deployed bytecode (requires include.deployedBytecode)
  proxy?: ProxyResolution             // resolved ERC-2535 facets / proxy implementations
}

interface TargetInfo {
  address: string
  selectors?: string[] // defined for diamond facets
  abi?: unknown[]      // filtered to selectors for diamond facets
  natspec?: NatSpec
  sources?: Record<string, string> // requires include.sources
}

interface ProxyResolution {
  pattern: ProxyPattern
  targets: TargetInfo[]
  compositeAbi?: unknown[]
  natspec?: NatSpec
}
```

Per-call overrides mirror the config shape:

```ts
// Disable a source and opt into extra fields for a single call
const result = await client.get('0x...', {
  sources: { sourcify: false },
  include: { sources: true, deployedBytecode: true },
})
```

Throws `ContractMetadataNotFoundError` if no source returns any data. Not-found errors include structured `source` and `reason` fields when a single source gives a meaningful signal, such as a Sourcify 404.

### `client.fetchRepository(address)`

Fetch only the repository source. Returns `null` if not found.

### `client.fetchContractURI(address)`

Fetch only the on-chain contractURI. Returns `null` if not found or no RPC configured.

### `client.fetchSourcify(address)`

Fetch only from Sourcify. Always requests `sources` and `deployedBytecode` alongside the base fields, and returns the raw `SourcifyResult` (ABI, parsed NatSpec, sources, bytecode).

### `client.fetchProxy(address, options?)`

Resolve ERC-2535 diamond facets or proxy implementation targets without running the full merge pipeline. Returns `null` if the contract is not a supported diamond/proxy or no RPC is configured; otherwise returns a `ProxyResolution`:

```ts
interface ProxyResolution {
  pattern: ProxyPattern
  targets: TargetInfo[]       // ERC-2535 facets or proxy implementations, plus ABI / NatSpec when Sourcify is enabled
  compositeAbi?: unknown[]    // deduped ABI across every target
  natspec?: NatSpec           // merged userdoc/devdoc across targets
  metadataLayer?: Partial<ContractMetadataDocument>  // functions/events/errors ready to merge
}
```

Per-target Sourcify lookups can be skipped when you only need the topology:

```ts
// Addresses + selectors only — no Sourcify traffic
const proxy = await client.fetchProxy('0x...', { sourcify: false })
```

### `merge(...layers)`

Standalone pure function for merging metadata layers. Exported for use outside the client.

```ts
import { merge } from '@evmnow/sdk'

const merged = merge(sourcifyLayer, contractUriLayer, repoLayer)
```

## Metadata document

The resolved document follows the [contract-metadata schema](https://github.com/evmnow/contract-metadata):

```ts
interface ContractMetadataDocument {
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
  [key: `_${string}`]: unknown   // extension fields allowed on any underscore-prefixed key
}
```

Function metadata includes fields like `title`, `description`, `intent`, `warning`, `params` (with types, labels, validation, autofill), `examples`, and more. See `src/types.ts` for the full type definitions.

## Includes (interfaces)

Repository metadata can reference shared interfaces via the `includes` field:

```json
{
  "includes": ["erc20", "ownable"],
  "name": "My Token"
}
```

Interfaces are fetched from the schema repo and merged as a base layer, with the document's own fields taking priority.

## Diamonds (ERC-2535) and Proxies

ERC-2535 diamond support is first-class. When the `proxy` source is enabled and an `rpc` is configured, the SDK detects diamonds via `supportsInterface(0x48e2b093)` with a `facets()` fallback, then returns `result.proxy.pattern === 'eip-2535-diamond'`. Each live facet is represented in `result.proxy.targets` with its address and selectors.

The same pipeline also handles common single-implementation proxy patterns. For each diamond facet or proxy implementation, the SDK fetches Sourcify separately, filters diamond facet ABIs to mounted selectors, and expands the result:

- `result.proxy.targets` — one entry per diamond facet or proxy implementation with its address, optional selectors, ABI, NatSpec, and source files when requested
- `result.abi` — composite ABI across the main contract + every target (first-occurrence wins, deduped by selector for functions and by signature for events/errors)
- `result.natspec` — `userdoc` / `devdoc` merged across the main contract and targets, main doc taking priority
- `result.sources` — main contract source files plus target source files when `include.sources` is enabled; for an unverified proxy with one verified implementation, this is the implementation source map
- `result.metadata.functions` / `events` / `errors` — NatSpec-derived sections from every target layered in at lowest priority, so curated repo/contractURI/main-Sourcify fields still win

Targets are fetched directly from Sourcify (not recursively through `client.get`), which guards against facets or implementations that themselves look like proxies. Setting `sources.sourcify: false` skips per-target Sourcify traffic as well — the target list still contains addresses and selectors, but ABI, NatSpec, and sources are omitted.

## Modular imports

Every module is published as a subpath export, so consumers can import a single utility without the full barrel:

```ts
import { merge, resolveIncludes } from '@evmnow/sdk/merge'
import { resolveUri } from '@evmnow/sdk/uri'
import { namehash, dnsEncode } from '@evmnow/sdk/ens'
import { ethCall, resolveEns, getChainId, decodeAbiString } from '@evmnow/sdk/rpc'
import { fetchRepository } from '@evmnow/sdk/sources/repository'
import { fetchContractURI } from '@evmnow/sdk/sources/contract-uri'
import { fetchSourcify, buildSourcifyLayer } from '@evmnow/sdk/sources/sourcify'
import {
  fetchProxy,
  detectProxy,
  detectDiamond,
  enrichTargets,
  composeProxyResolution,
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  mergeNatspecDocs,
  DIAMOND_LOUPE_INTERFACE_ID,
  SUPPORTS_INTERFACE_SELECTOR,
  FACETS_SELECTOR,
} from '@evmnow/sdk/sources/proxy'
import {
  ContractMetadataError,
  ContractMetadataNotFoundError,
  ContractNotVerifiedOnSourcifyError,
  ContractMetadataFetchError,
  ENSResolutionError,
} from '@evmnow/sdk/errors'
```

Every symbol above is also re-exported from the barrel (`@evmnow/sdk`).

### Standalone diamond/proxy resolution

When you only need diamond facet or proxy implementation topology, skip the client entirely:

```ts
import { fetchProxy } from '@evmnow/sdk/sources/proxy'

const proxy = await fetchProxy(
  'https://eth.llamarpc.com',   // rpc
  1,                            // chainId
  '0x...',                      // diamond or proxy address
  fetch,                        // fetch implementation
  { sourcifyUrl: 'https://sourcify.dev/server', sourcify: true, sources: true },
)
```

Pass `{ sourcify: false }` to return only the on-chain address + selector topology.

## Error handling

```ts
import {
  ContractMetadataNotFoundError,
  ContractNotVerifiedOnSourcifyError,
  ContractMetadataFetchError,
  ENSResolutionError,
} from '@evmnow/sdk'

try {
  const result = await client.get('0x...')
} catch (e) {
  if (e instanceof ContractNotVerifiedOnSourcifyError) {
    // Sourcify confirmed the contract is not verified
  } else if (e instanceof ContractMetadataNotFoundError) {
    // No metadata found from any source
    console.log(e.source, e.reason)
  }
  if (e instanceof ENSResolutionError) {
    // ENS name could not be resolved
  }
}
```

Individual source failures are swallowed — if Sourcify is down but the repository has data, you still get a result.

## License

MIT
