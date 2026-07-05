---
"@evmnow/sdk": minor
---

New `@evmnow/sdk/validate` subpath: `semanticChecks(doc, options)` runs the document-level semantic checks that the JSON Schema cannot express — cross-references (group and `related` targets), input-flag contracts (`hidden`/`disabled` require `autofill` and are mutually exclusive), action/event/error key formats, `tokenAddress`+`tokenParam` mutual exclusion, and variant ambiguity (actions on one function with identical locked parameters, which calldata matching cannot distinguish). Pure and filesystem-free — existence checks are injected via `options.interfaceExists`, and `options.expectedAddress` verifies the document's address. Returns structured `SemanticIssue { path, message }` objects. This is the canonical implementation previously duplicated in the contract-metadata repo's validate script, which now consumes it.
