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
| Lowest | **Diamond facets** (ERC-2535) | Per-facet ABI + NatSpec, merged into a composite ABI and `result.facets` |
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
  rpc: 'https://eth.llamarpc.com',        // needed for contractURI, diamond, ENS on mainnet
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
    diamond: true,      // default: true (requires rpc)
  },

  // Opt-in fields that aren't included by default
  include: {
    sources: false,           // verified source files from Sourcify
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
  facets?: FacetInfo[]                // per-facet info when the contract is an ERC-2535 diamond
}

interface FacetInfo {
  address: string
  selectors: string[]
  abi?: unknown[]      // the facet's ABI filtered to its mounted selectors
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

Throws `ContractMetadataNotFoundError` if no source returns any data.

### `client.fetchRepository(address)`

Fetch only the repository source. Returns `null` if not found.

### `client.fetchContractURI(address)`

Fetch only the on-chain contractURI. Returns `null` if not found or no RPC configured.

### `client.fetchSourcify(address)`

Fetch only from Sourcify. Always requests `sources` and `deployedBytecode` alongside the base fields, and returns the raw `SourcifyResult` (ABI, parsed NatSpec, sources, bytecode).

### `client.fetchDiamond(address, options?)`

Resolve ERC-2535 Diamond facets for an address without running the full merge pipeline. Returns `null` if the contract is not a diamond or no RPC is configured; otherwise returns a `DiamondResolution`:

```ts
interface DiamondResolution {
  facets: FacetInfo[]         // address + selectors, plus ABI / NatSpec when Sourcify is enabled
  compositeAbi?: unknown[]    // deduped ABI across every facet
  natspec?: NatSpec           // merged userdoc/devdoc across facets
  metadataLayer?: Partial<ContractMetadataDocument>  // functions/events/errors ready to merge
}
```

Per-facet Sourcify lookups can be skipped when you only need the topology:

```ts
// Addresses + selectors only — no Sourcify traffic
const diamond = await client.fetchDiamond('0x...', { sourcify: false })
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

## Diamonds (ERC-2535)

When the `diamond` source is enabled and an `rpc` is configured, the SDK detects [ERC-2535](https://eips.ethereum.org/EIPS/eip-2535) diamonds via `supportsInterface(0x48e2b093)` with a `facets()` fallback. For each live facet, it fetches Sourcify separately, filters the facet's ABI to its mounted selectors, and expands the result:

- `result.facets` — one entry per facet with its address, selectors, filtered ABI, and NatSpec
- `result.abi` — composite ABI across the main diamond + every facet (first-occurrence wins, deduped by selector for functions and by signature for events/errors)
- `result.natspec` — `userdoc` / `devdoc` merged across the diamond and its facets, main doc taking priority
- `result.metadata.functions` / `events` / `errors` — NatSpec-derived sections from every facet layered in at lowest priority, so curated repo/contractURI/main-Sourcify fields still win

Facets are fetched directly from Sourcify (not recursively through `client.get`), which guards against facets that themselves look like diamonds. Setting `sources.sourcify: false` skips per-facet Sourcify traffic as well — the facets list still contains addresses and selectors, but `abi` and `natspec` are omitted.

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
  fetchDiamond,
  detectAndFetchFacets,
  enrichFacets,
  composeDiamondResolution,
  decodeFacets,
  computeSelector,
  canonicalSignature,
  filterAbiBySelectors,
  buildCompositeAbi,
  mergeNatspecDocs,
} from '@evmnow/sdk/sources/diamond'
import {
  ContractMetadataError,
  ContractMetadataNotFoundError,
  ContractMetadataFetchError,
  ENSResolutionError,
} from '@evmnow/sdk/errors'
```

Every symbol above is also re-exported from the barrel (`@evmnow/sdk`).

### Standalone diamond resolution

When you only need facet info for an ERC-2535 diamond, skip the client entirely:

```ts
import { fetchDiamond } from '@evmnow/sdk/sources/diamond'

const diamond = await fetchDiamond(
  'https://eth.llamarpc.com',   // rpc
  1,                            // chainId
  '0x...',                      // diamond address
  fetch,                        // fetch implementation
  { sourcifyUrl: 'https://sourcify.dev/server', sourcify: true },
)
```

Pass `{ sourcify: false }` to return only the on-chain address + selector topology.

## Error handling

```ts
import {
  ContractMetadataNotFoundError,
  ContractMetadataFetchError,
  ENSResolutionError,
} from '@evmnow/sdk'

try {
  const result = await client.get('0x...')
} catch (e) {
  if (e instanceof ContractMetadataNotFoundError) {
    // No metadata found from any source
  }
  if (e instanceof ENSResolutionError) {
    // ENS name could not be resolved
  }
}
```

Individual source failures are swallowed — if Sourcify is down but the repository has data, you still get a result.

## License

MIT
