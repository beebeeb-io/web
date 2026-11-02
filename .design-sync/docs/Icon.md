---
category: Icons
---

The product's own stroke icon set (24x24 grid, 1.6 stroke, currentColor). `name` is an `IconName`; `size` in px (default 24); every SVG attribute passes through, so colour comes from a text class (`className="text-ink-3"`). An unknown name renders an empty box of the same size instead of crashing.

`shield` and `lock` mean encryption state; keep them for that. `globe` and `chat` are the VPN and Chat product glyphs (see `BBProductIcon`). File types have their own glyphs (`file-text`, `file-spreadsheet`, `file-code`, `file-archive`, `image`, ...).

```tsx
<Icon name="shield" size={16} className="text-amber-deep" />
```
