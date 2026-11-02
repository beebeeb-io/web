---
category: Brand
---

The Beebeeb product icon: the Beebeeb "b" on the tile, plus the product's glyph on a round badge at the bottom right. One pattern for every product: `drive` (folder), `pass` (key), `vpn` (globe), `mail` (envelope), `chat` (speech bubble). The only thing that changes between products is the glyph; there is no per-product colour. `tone="light"` (default) is an Amber tile with an ink b, for light surfaces; `tone="dark"` is an ink tile with an Amber b, for dark ones: pick it by the surface the icon sits on and never recolour it. `size` is the edge in px (default 40); the badge glyph reads from about 29 px up. Give it a `title` when it stands alone, so it has an accessible name; inside a lockup or next to the product name leave it off and it stays decorative.

The shield is reserved for encryption state, so VPN wears the globe. For the icon plus the name use `BBProductLockup`. Drive's shipped app icon is still the plain "b"; this component is the product-icon pattern.

```tsx
<BBProductIcon product="pass" size={96} title="Pass" />
<BBProductIcon product="drive" tone="dark" size={40} />
```
