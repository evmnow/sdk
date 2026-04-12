# CLAUDE.md

Contract Metadata SDK (`@evmnow/sdk`) — resolve complete contract metadata from multiple sources (repository, contractURI, Sourcify+NatSpec, ERC-2535 diamond facets).

## Code style

- TypeScript
- Single quotes, no semicolons

## Structure

- `src/` — Source code
- `src/index.ts` — Factory (`createContractClient`) + barrel exports + diamond expansion
- `src/types.ts` — Public types (config, client, document, schema-aligned)
- `src/errors.ts` — Error classes
- `src/merge.ts` — Pure merge logic (source priority + includes resolution)
- `src/sources/repository.ts` — Metadata repository fetcher (GitHub raw JSON)
- `src/sources/contract-uri.ts` — ERC-7572 contractURI on-chain + URI resolution
- `src/sources/sourcify.ts` — Sourcify v2 fetch (ABI + userdoc/devdoc → natspec parse)
- `src/sources/diamond.ts` — ERC-2535 detection, facet decoding, composite ABI, NatSpec merging
- `src/rpc.ts` — Minimal JSON-RPC client (eth_call, eth_chainId, ENS resolve)
- `src/ens.ts` — ENS namehash + DNS encoding + resolution via Universal Resolver
- `src/uri.ts` — URI resolution (data:, HTTPS, IPFS gateway)
- `test/` — Vitest tests (mirrors src structure)

## Key patterns

- Vite build step — outputs JS + `.d.ts` to `dist/`, source TS published alongside for editor navigation
- Factory pattern — `createContractClient(config)` returns a `ContractClient`
- Pure functions — `merge` exported directly for standalone use
- Minimal runtime dependencies — `@noble/hashes` (keccak256) + `@1001-digital/natspec` (parse only)
- Uses natspec as a parsing library only (pure `parse` + `toMetadata` functions, not its fetch client)

## Testing

Tests mock `globalThis.fetch` — no real network calls.
