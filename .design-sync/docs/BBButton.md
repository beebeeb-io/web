---
category: Actions
---

The one button for web and admin. Four variants, three sizes; it passes every native `<button>` attribute through (`onClick`, `disabled`, `type`, `data-testid`).

- `variant="amber"`: the primary action of a view (Upgrade, Update payment method). Amber is the one accent colour and is kept for primary actions and encryption state, so a view has at most one amber button.
- `variant="default"`: secondary actions (Retry, Keep both).
- `variant="ghost"`: low-emphasis actions in toolbars and dialogs (Start over, Back to sign in).
- `variant="danger"`: destructive actions (Delete permanently). Pair it with a confirmation step.
- `size`: `sm` in dense rows and banners, `md` by default, `lg` for a single hero action.

Disabled buttons keep their variant; show progress by disabling the button while the action runs. Labels are short verbs in sentence case, no emojis.

```tsx
<BBButton variant="amber" size="md" onClick={updatePayment}>Update payment method</BBButton>
<BBButton variant="ghost" onClick={startOver}>Start over</BBButton>
```
