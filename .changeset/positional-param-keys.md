---
'@evmnow/sdk': minor
---

Support positional `_N` parameter keys in action metadata: `matchAction` resolves
constraints by ABI position (name keys win), and locked keys that match no ABI
parameter fail the variant. Adds `paramMetaAt` and `actionRequiresSender` exports.
