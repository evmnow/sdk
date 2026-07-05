---
"@evmnow/sdk": minor
---

Detect ERC-20/ERC-721 standards from the final ABI (after proxy composition) and apply the bundled interface metadata layer at the lowest merge priority — labeled actions, groups, and semantic types like `token-amount` for any standard token, no curated document required. When no metadata layer provides `name`/`symbol`, they are read from the contract on-chain. Detection is reported in `result.interfaces` and can be disabled via `sources.interfaces`.
