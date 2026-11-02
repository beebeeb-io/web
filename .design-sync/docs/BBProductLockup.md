---
category: Brand
---

The Beebeeb product lockup: a `BBProductIcon`, then "Beebeeb" in Inter 700, then the product name in Inter 500 in `text-ink-2` (`Beebeeb Drive`, `Beebeeb VPN`). Use it for any product mark in a header, a switcher or a footer; never rebuild it from `BBLogo` and a text label, and never recolour it. `size` is the icon edge in px (default 40) and the name scales with it, never below 15 px. `tone="dark"` draws the ink tile with an Amber b and a hairline around the tile so it keeps its edge on a dark surface; the name colour follows the page theme (`dark` on a root element).

`BBLogo` stays the `beebeeb.io` wordmark text. The lockup is capitalised "Beebeeb", never the lowercase domain wordmark.

```tsx
<BBProductLockup product="mail" />
<BBProductLockup product="drive" size={29} />
```
