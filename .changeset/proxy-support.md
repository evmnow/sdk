---
'@evmnow/sdk': minor
---

Generalise ERC-2535 diamond support into full proxy-pattern resolution. The SDK now detects every major proxy convention, folds implementation-side ABI + NatSpec into the main result, and surfaces the detected pattern under `ContractResult.proxy`.

### Supported patterns

`detectProxy` tries each detector in priority order (first match wins):

- `eip-2535-diamond` — ERC-165 + loupe probe
- `eip-1967` — transparent / UUPS implementation slot (+ admin slot when present)
- `eip-1967-beacon` — beacon slot → `implementation()` on the beacon
- `eip-1822` — UUPS `PROXIABLE` slot
- `eip-1167` — minimal-proxy / clone bytecode sniff
- `gnosis-safe` — singleton at storage slot 0
- `eip-897` — `implementation()` view function (last resort)

Single-hop only: a resolved implementation that itself looks like a proxy is not followed. Beacon stays supported as a defined two-step pattern.

### What consumers get

For every proxy, the SDK now resolves the implementation's ABI + NatSpec from Sourcify and composes them into the top-level result:

- `result.abi` — composite ABI (main-contract ABI first when present, then each target's ABI; first-wins selector dedup)
- `result.natspec` — merged `userdoc` / `devdoc` (main-contract docs first, then target docs)
- `result.metadata.functions` / `events` / `errors` — the target-derived metadata layer sits at the lowest priority; curated repository / contractURI / main-contract Sourcify still wins
- `result.proxy` — `{ pattern, targets[], beacon?, admin?, compositeAbi?, metadataLayer?, natspec? }` so consumers can display "this is a 1967 proxy to 0xabc…" or "this is a diamond with N facets"

Metadata files in the sibling `contract-metadata` repo remain authored against the proxy address — no schema changes.

### Breaking changes

Both this package and the detection primitives are pre-1.0; the rename is a clean break rather than aliased compatibility.

- Dependency: `@1001-digital/diamonds` → `@1001-digital/proxies`
- Client method: `client.fetchDiamond()` → `client.fetchProxy()`
- Result field: `ContractResult.facets?: FacetInfo[]` → `ContractResult.proxy?: ProxyResolution`
- Source config: `sources.diamond` → `sources.proxy`
- Types: `DiamondResolution` → `ProxyResolution`; `FacetInfo` → `TargetInfo`; `FetchDiamondOptions` → `FetchProxyOptions`; `RawFacet` removed (replaced by `RawProxy` + `ResolvedTarget`)
- Module subpath: `@evmnow/sdk/sources/diamond` → `@evmnow/sdk/sources/proxy`
- Standalone function: `fetchDiamond` → `fetchProxy`; `enrichFacets` → `enrichTargets`; `composeDiamondResolution` → `composeProxyResolution`
- New re-exports: `detectProxy`, `detectDiamond`, `detectEip1967`, `detectEip1967Beacon`, `detectEip1822`, `detectEip1167`, `detectGnosisSafe`, `detectEip897`, and the associated storage-slot constants

### Migration

```diff
-import type { DiamondResolution, FacetInfo } from '@evmnow/sdk'
+import type { ProxyResolution, TargetInfo } from '@evmnow/sdk'

 const client = createContractClient({ chainId: 1, rpc })
-const diamond = await client.fetchDiamond(address)
-console.log(diamond?.facets)
+const proxy = await client.fetchProxy(address)
+console.log(proxy?.pattern, proxy?.targets)

-client.get(address, { sources: { diamond: false } })
+client.get(address, { sources: { proxy: false } })

 const result = await client.get(address)
-result.facets
+result.proxy?.targets
```

Diamond behaviour is preserved exactly — it's now one `pattern` value (`'eip-2535-diamond'`) among seven.
