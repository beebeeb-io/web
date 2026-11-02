---
category: Status
---

A small status label: `default` (neutral: roles like Admin, Member, Viewer; billing terms like Monthly), `amber` (encryption state; billing also uses it for pending and open payments), `green` (paid, issued), `red` (failed, canceled). Text is short and literal; never a button.

```tsx
<BBChip>Member</BBChip>
<BBChip variant="green">Paid</BBChip>
```
