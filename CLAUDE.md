# CLAUDE.md

Contract Metadata SDK (`@evmnow/sdk`) — resolve complete contract metadata from multiple sources (repository, contractURI, Sourcify+NatSpec, proxy implementations including ERC-2535 diamonds, EIP-1967, EIP-1167, beacons, and Safe).

## Code style

- TypeScript
- Single quotes, no semicolons

## Structure

- `src/` — Source code
- `src/index.ts` — Factory (`createContractClient`) + barrel exports. Owns the client-level composition step that layers main-contract Sourcify data on top of the target-only `ProxyResolution`.
- `src/types.ts` — Public types (config, client, document, schema-aligned)
- `src/errors.ts` — Error classes
- `src/merge.ts` — Pure merge logic (source priority + includes resolution)
- `src/sources/repository.ts` — Metadata repository fetcher (GitHub raw JSON)
- `src/sources/contract-uri.ts` — ERC-7572 contractURI on-chain + URI resolution
- `src/sources/sourcify.ts` — Sourcify v2 fetch (ABI + userdoc/devdoc → natspec parse)
- `src/sources/proxy.ts` — Proxy detection (ERC-2535, EIP-1967, EIP-1167, beacon, Safe, EIP-1822, EIP-897), Sourcify-bound enrichment, composite ABI, metadata layer
- `src/natspec.ts` — Pure: `mergeNatspecDocs` (Solidity-specific userdoc/devdoc merge; SDK-local to keep `@1001-digital/proxies` format-agnostic)
- `src/rpc.ts` — Minimal JSON-RPC client (eth_call, eth_chainId, ENS resolve)
- `src/ens.ts` — ENS namehash + DNS encoding + resolution via Universal Resolver
- `src/uri.ts` — URI resolution (data:, HTTPS, IPFS gateway)
- `test/` — Vitest tests (mirrors src structure)

## Key patterns

- Vite build with `preserveModules: true` mirrors `src/` → `dist/` 1:1 — each module is an independently importable subpath under `@evmnow/sdk/...` (declared in `package.json#exports`)
- `sideEffects: false` in package.json — enables aggressive tree-shaking
- Factory pattern — `createContractClient(config)` returns a `ContractClient` with `get`, `fetchRepository`, `fetchContractURI`, `fetchSourcify`, `fetchProxy`
- Pure/standalone exports — `merge`, `resolveIncludes`, `decodeFacets`, `computeSelector`, `canonicalSignature`, `filterAbiBySelectors`, `buildCompositeAbi`, `mergeNatspecDocs`, `enrichTargets`, `composeProxyResolution`, per-pattern detectors (`detectDiamond`, `detectEip1967`, `detectEip1967Beacon`, `detectEip1822`, `detectEip1167`, `detectGnosisSafe`, `detectEip897`), `detectProxy` orchestrator, and each source's `fetchX` are all usable without the client
- Minimal runtime dependencies — `@1001-digital/proxies` (proxy detection + ABI/NatSpec utilities) + `@1001-digital/natspec` (parse only)
- Uses natspec as a parsing library only (pure `parse` + `toMetadata` functions, not its fetch client)

## Proxy pipeline

- `detectProxy` — tries patterns in priority order (`eip-2535-diamond → eip-1967 → eip-1967-beacon → eip-1822 → eip-1167 → gnosis-safe → eip-897`); returns `RawProxy | null`. Single-hop only.
- `enrichTargets(targets, sourcifyFetch)` — dependency-injected fetcher (pass `null` to skip Sourcify). Returns `TargetInfo[]` plus raw `SourcifyResult[]` so callers can build their own derived layers. ABI is filtered by selectors for diamond facets; passed through untouched for single-impl proxies.
- `composeProxyResolution` — pure; builds `compositeAbi`, `metadataLayer`, and merged `natspec` from enriched targets + their sourcify results.
- `fetchProxy` — high-level: detect → enrich → compose in one call.
- `sources.sourcify: false` on the client disables per-target Sourcify lookups as well — no hidden traffic.
- Metadata authoring stays on the proxy address; the SDK surfaces `result.proxy` (pattern, targets, beacon?, admin?, compositeAbi?, metadataLayer?, natspec?) so consumers know where the real code lives. Main-contract repo/contractURI/Sourcify still wins at the top-level metadata merge; target data slots in at the lowest priority.

## Testing

Tests mock `globalThis.fetch` — no real network calls.
