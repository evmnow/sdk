---
"@evmnow/sdk": minor
---

Correctness, robustness, and API hardening across the SDK.

**Fixes**

- Sourcify v2: request the valid `runtimeBytecode` field instead of `deployedBytecode` (which the live API rejects with HTTP 400) and surface `runtimeBytecode.onchainBytecode` as `deployedBytecode`. Field selectors are validated against the known v2 field list (`buildSourcifyFields`, `SOURCIFY_V2_FIELDS`).
- Repository source: chain-aware lookups — `contracts/{chainId}/{address}.json` first with a flat-layout fallback; documents with a mismatched `chainId` are discarded; malformed JSON shapes (arrays, non-string `includes`) return null instead of crashing `get()`.
- `merge` / `mergeNatspecDocs` skip `__proto__`, `constructor`, and `prototype` keys (prototype-pollution hardening).
- ENS names are lowercased before the `.eth` check and hashing, so `Vitalik.eth` / `VITALIK.ETH` resolve correctly.
- Diamond facets: NatSpec methods and derived actions are filtered to mounted selectors so unmounted facet functions can't inject actions.
- Multi-target proxy `metadataLayer` is now first-target-wins, consistent with the NatSpec merge.
- On-chain `name()`/`symbol()` fill uses the bytes32-aware, sanitizing token decoder (fixes MKR/SAI-style tokens; hostile values are capped/stripped).
- Calldata matching treats a missing `call.value` as `0` for locked value constraints.
- Event/error key validation flags truncated and uppercase hex keys; the action signature grammar accepts `$` identifiers, aligned between `actions.ts` and `validate.ts`.
- Mixed-case addresses are EIP-55 checksum-validated and rejected with `InvalidAddressError` on mismatch.

**Robustness**

- JSON-RPC calls carry a 10s abort timeout.
- `includes` resolution only follows `https:` URLs; the schema base is configurable (`schemaBaseUrl`, default `https://evmnow.github.io/contract-metadata/v1`).
- `resolveUri` caps response bodies at ~1 MB and recognizes the `data:application/json;charset=utf-8,` variant.
- Sourcify responses are shape-validated (non-object bodies, non-record natspec, non-array ABIs).

**New options & API**

- `ContractClientConfig`: `schemaBaseUrl`, `cache` (per-client memoization + in-flight dedup of repository/Sourcify fetches, default on), `ensResolver` (custom ENS Universal Resolver address).
- New error classes: `InvalidAddressError`, `ChainIdMismatchError`, `ContractClientConfigError`.
- New exports: `filterSourcifyBySelectors`, `buildSourcifyFields`, `SOURCIFY_V2_FIELDS`, `decodeSymbol`, `sanitizeSymbol`, `normalizeEnsName`, `UNIVERSAL_RESOLVER`, `AbiItem`.
- New subpath exports: `./actions`, `./natspec`, `./interfaces/detect`, `./interfaces/erc20`, `./interfaces/erc721`, `./package.json`.
- `ContractResult.abi`, `ProxyResolution.compositeAbi`, `TargetInfo.abi`, and `SourcifyResult.abi` are now typed as `AbiItem[]` instead of `unknown[]`.
- Token info resolver fetches `decimals()` and `symbol()` concurrently.
