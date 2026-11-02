# Building with the Beebeeb design system

Beebeeb is end-to-end encrypted cloud storage made in Europe. Drive, Pass, VPN, Mail and Chat are ONE system: the same tokens, components and single Amber accent. A product differs by its name and icon only: no per-product colour, typeface, radius or shadow.

## Setup
- No provider or wrapper. `styles.css` carries the tokens, the fonts (Inter 400-700, JetBrains Mono 400-500) and every utility class the product uses. Components are on `window.Beebeeb` (`BBButton`, `BBInput`, `BBChip`, `BBCheckbox`, `BBToggle`, `BBLogo`, `BBProductIcon`, `BBProductLockup`, `Icon`, the skeletons).
- Put `bg-paper text-ink font-sans` on the page root. Dark mode: add the class `dark` to a root element; every token switches under it. Never write `dark:` variants or colour literals.
- Only classes compiled into `styles.css` resolve. For anything else, use the CSS variables inline: `style={{ width: 420, boxShadow: 'var(--shadow-3)' }}`.

## The Amber rule
Amber (`--color-amber`) means encryption state and the one primary action of a view, nothing else. Use `BBButton variant="amber"` once per view, `BBChip variant="amber"` or a `shield`/`lock` icon in `text-amber-deep` for encryption state. Amber you read (text, icons) is `text-amber-deep`, never `text-amber`. Green is success, red is error and destructive: states, not accents. Never use Amber for selection, hover, tabs, links or decoration.

## Class vocabulary (compiled)
| Family | Classes |
|---|---|
| Surface | `bg-paper` `bg-paper-2` `bg-paper-3` `bg-ink` (inverse) |
| Text | `text-ink` `text-ink-2` `text-ink-3` `text-ink-4` `text-paper` |
| Lines | `border-line` `border-line-2` `divide-line` |
| Accent | `bg-amber` `bg-amber-bg` `text-amber-deep` `border-amber-deep` |
| State | `text-green` `bg-green-bg` `border-green-border` `text-red` `bg-red` `bg-red-bg` `border-red-border` |
| Spacing | named: `p-md` `p-xl` `px-sm` `px-md` `px-lg` `py-xs` `py-sm` `gap-sm` `gap-md`; numeric: `p-4` `px-4` `py-3` `gap-2` `gap-3` |
| Radius | `rounded-sm` 4 `rounded-md` 6 `rounded-lg` 10 `rounded-xl` 14 `rounded-full` |
| Elevation | `shadow-1` rest, `shadow-2` raised, `shadow-3` dialogs, menus, trays |
| Type | `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl`; `font-medium` `font-semibold` `font-bold` |

Inter (`font-sans`) for what people read. JetBrains Mono (`font-mono`) for what machines produce: sizes, dates, IDs, hashes, speeds, key fragments.

## Components
Read each component's `.prompt.md` and `.d.ts` before using it. Two shipped behaviours to know: `BBButton` and `BBInput` have no disabled styling, so pair `disabled` with a label that says what is happening ("Saving…", "Deleting…"); `BBLogo` is the text wordmark `beebeeb.io` with an Amber `.io`; never recolour it.

## Products
The main Beebeeb icon stays the plain "b" tile: it is the master brand mark and the app icon that ships today, so never replace or restyle it. Each product (Drive, Pass, VPN, Mail, Chat) shows the same "b" with its own little badge: `BBProductIcon` is that icon alone, `BBProductLockup` is the full logo (the icon, the unchanged `beebeeb.io` wordmark and the product name underneath it as a small uppercase mono label). Never draw a product tile, glyph, wordmark or name by hand and never recolour one: every product uses the same pattern and differs by its glyph and its name only. Pick `tone="dark"` on dark surfaces. The shield is for encryption state only, so VPN's glyph is the globe.

## Copy
Honest over reassuring, sentence case, no emojis. Say "Europe" or "the EU"; never name a hosting provider or a city, and never show a location that is not live. Errors say what happened and what to do: "Wrong password. Try again."

## Example
```tsx
const { BBButton, BBChip, BBInput, Icon } = window.Beebeeb
<div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-4">
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-ink">Shared folder</span>
    <BBChip variant="amber">End-to-end encrypted</BBChip>
  </div>
  <BBInput label="Email" type="email" icon="mail" placeholder="you@example.com" />
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 font-mono text-xs text-ink-3">
      <Icon name="lock" size={14} className="text-amber-deep" /> All encrypted · AES-256-GCM
    </span>
    <BBButton variant="amber">Share</BBButton>
  </div>
</div>
```
