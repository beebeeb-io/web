---
category: Brand
---

The Beebeeb full logo for a product: a `BBProductIcon`, then the unchanged `beebeeb.io` wordmark (Inter 700, ".io" in Amber), with the product name underneath it as a small label in JetBrains Mono, UPPERCASE and widely tracked, in `text-ink-2`. Wordmark and label are left-aligned and the label sits close under the wordmark. Use it for any product mark in a header, a switcher or a footer; never rebuild it from `BBLogo` and a text label, and never recolour it. `size` is the icon edge in px (default 40) and the wordmark and the label scale with it together. `tone="dark"` draws the ink tile with an Amber b and a hairline around the tile so it keeps its edge on a dark surface; the text colours follow the page theme (`dark` on a root element).

Below about 29 px the label is hard to read (it stops shrinking at 9 px): for anything smaller use `BBProductIcon` alone.

The main Beebeeb logo (the plain "b" tile and `beebeeb.io`) stays as it is and is not made with this component; `BBLogo` stays the `beebeeb.io` wordmark text.

```tsx
<BBProductLockup product="mail" />
<BBProductLockup product="drive" size={29} />
```
