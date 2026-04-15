# @evmnow/sdk

## 0.1.3

### Patch Changes

- [`f2a6f75`](https://github.com/evmnow/sdk/commit/f2a6f7554d3a4d9cfd42f93181afbea6057cde58) Thanks [@jwahdatehagh](https://github.com/jwahdatehagh)! - Update proxies library

## 0.1.2

### Patch Changes

- [`0e03e1f`](https://github.com/evmnow/sdk/commit/0e03e1fa40156807b38fafef67bc9960a5f89a36) Thanks [@yougogirldoteth](https://github.com/yougogirldoteth)! - Add structured not found errors for sourcify misses

## 0.1.1

### Patch Changes

- [`6dc8182`](https://github.com/evmnow/sdk/commit/6dc8182ed8a8c100f639455759a83735dcfd0d81) Thanks [@yougogirldoteth](https://github.com/yougogirldoteth)! - Fix resolving ENS

## 0.1.0

### Minor Changes

- [`7fe475b`](https://github.com/evmnow/sdk/commit/7fe475bd25ee190b510352353dc3403542259149) Thanks [@jwahdatehagh](https://github.com/jwahdatehagh)! - Initial release of `@evmnow/sdk` — resolve complete contract metadata from multiple sources.

  ### Sources

  - **Repository** — curated JSON from the `contract-metadata` GitHub repo.
  - **contractURI (ERC-7572)** — on-chain contractURI resolution (HTTPS, IPFS, `data:`).
  - **Sourcify v2** — ABI, NatSpec (`userdoc` / `devdoc`), optionally sources + deployed bytecode.
  - **On-chain proxies** — every major proxy convention: ERC-2535 diamonds, EIP-1967 (transparent / UUPS + beacon), EIP-1822, EIP-1167 clones, Gnosis Safe, EIP-897. Implementation-side ABI + NatSpec are folded back into the main result.

  ### Features

  - **`createContractClient(config)`** — factory returning a client with `get`, `fetchRepository`, `fetchContractURI`, `fetchSourcify`, `fetchProxy`.
  - **`client.get(addressOrEns)`** — resolves ENS, fetches every enabled source in parallel, resolves `includes`, and returns a single `ContractResult` with merged metadata, ABI, NatSpec, optional sources + deployed bytecode, and detected proxy info.
  - **Layered merge** — curated repository wins over contractURI wins over Sourcify wins over implementation-derived metadata. Record sections (`functions`, `events`, `errors`, …) shallow-merge per key.
  - **`includes` resolution** — interface references (e.g. `interface:erc721`) are fetched from the schema base and merged left-to-right under the document.
  - **Proxy pipeline** — `detectProxy` orchestrator with priority ordering; single-hop resolution; `sources.proxy: false` skips detection entirely; `sources.sourcify: false` also disables per-target lookups (no hidden traffic).
  - **ENS resolution** — `.eth` names via Universal Resolver, with explicit mainnet RPC support when `chainId !== 1`.
  - **Dependency-injected `fetch`** — pass any fetch-compatible function; no implicit globals.
  - **Pure/standalone exports** — `merge`, `resolveIncludes`, `fetchRepository`, `fetchContractURI`, `fetchSourcify`, `buildSourcifyLayer`, `fetchProxy`, `detectProxy` + per-pattern detectors, `enrichTargets`, `composeProxyResolution`, `buildCompositeAbi`, `filterAbiBySelectors`, `computeSelector`, `canonicalSignature`, `mergeNatspecDocs`, `decodeFacets`, `resolveUri`, `namehash`, `dnsEncode`, RPC helpers — all usable without the client.

  ### Result shape

  ```ts
  interface ContractResult {
    chainId: number;
    address: string;
    metadata: ContractMetadataDocument; // merged across every source
    abi?: unknown[]; // composite (main contract + implementation targets)
    natspec?: { userdoc?; devdoc? };
    sources?: Record<string, string>;
    deployedBytecode?: string;
    proxy?: ProxyResolution; // pattern, targets, beacon?, admin?, …
  }
  ```

  ### Package layout

  - Vite build with `preserveModules: true` mirrors `src/` → `dist/` 1:1 — every module is independently importable under `@evmnow/sdk/...` (declared in `package.json#exports`).
  - `sideEffects: false` for aggressive tree-shaking.
  - Minimal runtime dependencies: `@1001-digital/proxies`, `@1001-digital/natspec`, `@noble/hashes`.
