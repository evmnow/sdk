# @evmnow/sdk

Resolve complete contract metadata for any EVM contract from multiple sources — curated repository, on-chain `contractURI` (ERC-7572), and Sourcify + NatSpec — merged into a single document.

## Install

```
npm install @evmnow/sdk
```

## Quick start

```ts
import { createContractMetadata } from '@evmnow/sdk'

const client = createContractMetadata({
  chainId: 1,
  rpc: 'https://eth.llamarpc.com',
})

const metadata = await client.get('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')

console.log(metadata.name)        // "Uniswap"
console.log(metadata.description) // ...
console.log(metadata.functions)   // { "delegate(address)": { title: "...", ... }, ... }
```

ENS names work too:

```ts
const metadata = await client.get('uniswap.eth')
```

## How it works

The SDK fetches metadata from three sources in parallel, then merges them with increasing priority:

| Priority | Source | What it provides |
|----------|--------|-----------------|
| Lowest | **Sourcify** | Contract name, function/event/error descriptions from NatSpec comments |
| Medium | **contractURI** | On-chain ERC-7572 fields: name, symbol, description, image, links |
| Highest | **Repository** | Curated JSON from the [evmnow/contract-metadata](https://github.com/evmnow/contract-metadata) repo — full control over every field |

Higher-priority sources override lower ones. Record sections (`functions`, `events`, `errors`, `messages`, `groups`) are shallow-merged per key, so a repository entry can add a `title` to a function while keeping the NatSpec `description` from Sourcify.

## Configuration

```ts
const client = createContractMetadata({
  // Required
  chainId: 1,

  // Optional
  rpc: 'https://eth.llamarpc.com',       // needed for contractURI + ENS resolution
  repositoryUrl: '...',                    // custom metadata repo base URL
  sourcifyUrl: 'https://sourcify.dev/server',
  ipfsGateway: 'https://ipfs.io',
  fetch: customFetch,                     // custom fetch implementation

  // Disable specific sources globally
  sources: {
    repository: true,  // default: true
    contractURI: true,  // default: true (requires rpc)
    sourcify: true,     // default: true
  },
})
```

## API

### `createContractMetadata(config)` → `ContractMetadataClient`

Creates a client bound to a specific chain.

### `client.get(addressOrEns, options?)`

Fetches and merges metadata from all enabled sources. Accepts a `0x` address or `.eth` ENS name (requires `rpc`).

```ts
// Disable a source for a single call
const metadata = await client.get('0x...', {
  sources: { sourcify: false },
})
```

Throws `ContractMetadataNotFoundError` if no source returns any data.

### `client.fetchRepository(address)`

Fetch only the repository source. Returns `null` if not found.

### `client.fetchContractURI(address)`

Fetch only the on-chain contractURI. Returns `null` if not found or no RPC configured.

### `client.fetchSourcify(address)`

Fetch only from Sourcify. Returns the raw `SourcifyResult` (ABI + parsed NatSpec).

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
  chainId: number
  address: string
  name?: string
  symbol?: string
  description?: string
  image?: string
  banner_image?: string
  external_link?: string
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
  // ...
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

## Error handling

```ts
import {
  ContractMetadataNotFoundError,
  ContractMetadataFetchError,
  ENSResolutionError,
} from '@evmnow/sdk'

try {
  const metadata = await client.get('0x...')
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
