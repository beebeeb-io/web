# Task recipes — web

The shortest honest path for each task this repo is asked for repeatedly. `MAP.md` is how to find
anything else. Every file and item below is proved to exist by `make recipes-check`.

## Add a page

- Files: `src/app.tsx` (1), `src/pages/billing.tsx` (2), `src/pages/MAP.md` (3)
- Pattern: `lazyNamed` in `src/app.tsx` (the lazy route wrapper, then the `<Route>` and nav entry); `Billing` in `src/pages/billing.tsx` (the named component plus its `export const` alias the lazy import names)
- Check: `bunx tsc --noEmit`

## Call a new endpoint

- Files: `src/lib/api-billing.ts` (1), `src/lib/api.ts` (2), `packages/shared/src/api/request.ts` (3), `src/pages/billing/use-billing-data.ts` (4)
- Pattern: `getBillingProfile` in `src/lib/api-billing.ts` (one function per endpoint, its row types beside it); `request` in `packages/shared/src/api/request.ts` (the only fetch door: auth, retry, rate limit); `useBillingData` in `src/pages/billing/use-billing-data.ts` (the hook that loads it)
- Check: `bunx tsc --noEmit`

## Add a shared component

- Files: `src/components/bb-chip.tsx` (1), `src/components/MAP.md` (2), `src/pages/billing/BillingSummaryView.tsx` (3)
- Pattern: `BBChip` in `src/components/bb-chip.tsx` (the `bb-*` primitive shape: a variant map, props typed next to it, no state); `BillingSummaryView` in `src/pages/billing/BillingSummaryView.tsx` (a consumer that reads the page model)
- Check: `bunx tsc --noEmit`

## Add a locale string

- Files: `src/locales/en.json` (1), `src/lib/i18n.ts` (2), `src/pages/settings/appearance.tsx` (3)
- Pattern: `i18n` in `src/lib/i18n.ts` (the single init: `en` is the only bundle); `SettingsAppearance` in `src/pages/settings/appearance.tsx` (the consumer shape: `useTranslation()`, then `t('…')`)
- Check: `bunx tsc --noEmit`
