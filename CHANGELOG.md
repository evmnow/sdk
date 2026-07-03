# @evmnow/sdk

## 0.3.0

### Minor Changes

- [`3e23f05`](https://github.com/evmnow/sdk/commit/3e23f0570a8938aead304fb55e8059b8cad19e98) Thanks [@jwahdatehagh](https://github.com/jwahdatehagh)! - Support positional `_N` parameter keys in action metadata: `matchAction` resolves
  constraints by ABI position (name keys win), and locked keys that match no ABI
  parameter fail the variant. Adds `paramMetaAt` and `actionRequiresSender` exports.

## 0.2.0

### Minor Changes

- [#5](https://github.com/evmnow/sdk/pull/5) [`0a75783`](https://github.com/evmnow/sdk/commit/0a75783d988ac68651a2439b259da3399183df4c) Thanks [@jwahdatehagh](https://github.com/jwahdatehagh)! - Adopt the ABI-independent actions model from the contract-metadata spec.

  The `functions` document section becomes `actions`, keyed by free-form identifier with an optional `function` reference (bare name, signature, or 4-byte selector — defaults to the action id). New `resolveActions(abi, doc)` resolves authored actions against the ABI and synthesizes a default action for every function no authored action references; authoring problems are surfaced as structured issues. New `matchAction(actions, call)` implements the spec's calldata-matching algorithm: locked parameters (hidden/disabled with a resolvable autofill) act as equality constraints against decoded arguments, the most-locked surviving candidate wins, and ties break deterministically by `order` then id. Actions may also describe the native currency attached to payable calls via a `value` object (`ValueMeta`), which participates in matching and validation. Sourcify NatSpec output is converted into the actions shape.

- [`302ed16`](https://github.com/evmnow/sdk/commit/302ed16631c7306cc947586a01e1be093742a58d) Thanks [@jwahdatehagh](https://github.com/jwahdatehagh)! - Add canonical amount formatting for the `eth`, `gwei`, `amount`, and `token-amount` semantic types.

  New pure, dependency-free `@evmnow/sdk/format` module: `formatAmount`, `parseAmount`, `formatUnits`, `parseUnits`, `resolveAmountDisplay`, `amountKind`, and `isAmountType`. Also fixes a schema drift by adding the missing `{ type: 'amount', decimals?, symbol? }` variant to `ParamType` (exported as `AmountType`).

## 0.1.4

### Patch Changes

- [#8](https://github.com/evmnow/sdk/pull/8) [`af2eb8b`](https://github.com/evmnow/sdk/commit/af2eb8b374c96ccecc1335f12039f466fdb5cde2) Thanks [@yougogirldoteth](https://github.com/yougogirldoteth)! - Include verified source files for proxy targets when `include.sources` is enabled.

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
