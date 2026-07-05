---
'@evmnow/sdk': minor
---

Resolve legacy ZeppelinOS (pre-EIP-1967) proxies via `@1001-digital/proxies` 0.2.0.

Contracts like Circle's USDC (`FiatTokenProxy`) store their implementation at `keccak256('org.zeppelinos.proxy.implementation')` and were previously not detected — `client.get` returned only the proxy's own ABI. They now resolve through the standard proxy pipeline (`result.proxy.pattern === 'zeppelinos'`), with the implementation ABI merged into the composite ABI.

Re-exports the new `detectZeppelinOs`, `ZEPPELINOS_IMPL_SLOT`, and `ZEPPELINOS_ADMIN_SLOT` from `@evmnow/sdk/sources/proxy`.
