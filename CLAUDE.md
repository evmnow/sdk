# CLAUDE.md

Contract Metadata SDK (`@evmnow/sdk`) — resolve complete contract metadata from multiple sources (repository, contractURI, Sourcify+NatSpec, ERC-2535 diamond facets).

## Code style

- TypeScript
- Single quotes, no semicolons

## Structure

- `src/` — Source code
- `src/index.ts` — Factory (`createContractClient`) + barrel exports. Owns the client-level composition step that layers main-contract Sourcify data on top of the facet-only `DiamondResolution`.
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

- Vite build with `preserveModules: true` mirrors `src/` → `dist/` 1:1 — each module is an independently importable subpath under `@evmnow/sdk/...` (declared in `package.json#exports`)
- `sideEffects: false` in package.json — enables aggressive tree-shaking
- Factory pattern — `createContractClient(config)` returns a `ContractClient` with `get`, `fetchRepository`, `fetchContractURI`, `fetchSourcify`, `fetchDiamond`
- Pure/standalone exports — `merge`, `resolveIncludes`, `decodeFacets`, `computeSelector`, `canonicalSignature`, `filterAbiBySelectors`, `buildCompositeAbi`, `mergeNatspecDocs`, `enrichFacets`, `composeDiamondResolution`, and each source's `fetchX` are all usable without the client
- Minimal runtime dependencies — `@noble/hashes` (keccak256) + `@1001-digital/natspec` (parse only)
- Uses natspec as a parsing library only (pure `parse` + `toMetadata` functions, not its fetch client)

## Diamond pipeline

- `detectAndFetchFacets` — on-chain probe, returns `RawFacet[] | null`
- `enrichFacets(rawFacets, sourcifyFetch)` — dependency-injected fetcher (pass `null` to skip Sourcify). Returns enriched `FacetInfo[]` plus the raw `SourcifyResult[]` so callers can build their own derived layers
- `composeDiamondResolution` — pure; builds `compositeAbi`, `metadataLayer`, and merged `natspec` from `enrichFacets` output
- `fetchDiamond` — high-level: detect → enrich → compose in one call
- `sources.sourcify: false` on the client disables per-facet Sourcify lookups as well — no hidden traffic

## Testing

Tests mock `globalThis.fetch` — no real network calls.
