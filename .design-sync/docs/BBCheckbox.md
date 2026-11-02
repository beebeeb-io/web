---
category: Forms
---

A controlled checkbox (`checked` + `onChange(checked)`) with an optional `label` and an `indeterminate` state for "some selected" (the select-all box of a file list). The checked box is amber.

```tsx
<BBCheckbox checked={agreed} onChange={setAgreed} label="I have saved my recovery phrase offline." />
```
