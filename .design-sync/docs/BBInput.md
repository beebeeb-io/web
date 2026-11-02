---
category: Forms
---

A labelled text field: optional `label`, `hint`, a leading `icon` (any `IconName`), a `trailing` slot (a show-password button, a unit) and an `error` message that replaces the hint and turns the border red. All other `<input>` attributes pass through (`type`, `value`, `onChange`, `placeholder`, `autoComplete`).

Focus shows an amber ring; errors say what is wrong and how to fix it, in plain words.

```tsx
<BBInput label="Email" type="email" icon="mail" placeholder="you@example.com" />
<BBInput label="Password" type="password" icon="lock" error="Wrong password. Try again." />
```
