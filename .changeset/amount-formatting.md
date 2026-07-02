---
"@evmnow/sdk": minor
---

Add canonical amount formatting for the `eth`, `gwei`, `amount`, and `token-amount` semantic types.

New pure, dependency-free `@evmnow/sdk/format` module: `formatAmount`, `parseAmount`, `formatUnits`, `parseUnits`, `resolveAmountDisplay`, `amountKind`, and `isAmountType`. Also fixes a schema drift by adding the missing `{ type: 'amount', decimals?, symbol? }` variant to `ParamType` (exported as `AmountType`).
