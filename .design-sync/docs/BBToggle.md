---
category: Forms
---

The one switch, shared by web and admin: `on` + `onChange(on)`, `disabled`, and an `aria-label` when there is no visible label. Sizes: `md` (track 36x20, the web default), `touch` (track 44x26), `adaptive` (touch below 768px, md above). The hit box is larger than the track but takes the track's footprint in layout. On is amber.

```tsx
<BBToggle aria-label="Activity tracking" on={optedIn} onChange={setOptedIn} />
```
