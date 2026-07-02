---
"@evmnow/sdk": minor
---

Adopt the ABI-independent actions model from the contract-metadata spec.

The `functions` document section becomes `actions`, keyed by free-form identifier with an optional `function` reference (bare name, signature, or 4-byte selector — defaults to the action id). New `resolveActions(abi, doc)` resolves authored actions against the ABI and synthesizes a default action for every function no authored action references; authoring problems are surfaced as structured issues. New `matchAction(actions, call)` implements the spec's calldata-matching algorithm: locked parameters (hidden/disabled with a resolvable autofill) act as equality constraints against decoded arguments, the most-locked surviving candidate wins, and ties break deterministically by `order` then id. Actions may also describe the native currency attached to payable calls via a `value` object (`ValueMeta`), which participates in matching and validation. Sourcify NatSpec output is converted into the actions shape.
