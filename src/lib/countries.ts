// ISO-3166-1 alpha-2 country list for the billing form (task 0919).
// EU member states first (VAT-relevant for OSS / reverse-charge), then a short
// set of common non-EU countries. The server is the source of truth for VAT
// treatment — this list only drives the selector + the vat-preview query.

import type { CompanyRegistrationType } from './api'

export interface Country {
  code: string
  name: string
  /** EU member state — drives the "EU VAT applies" grouping in the selector. */
  eu: boolean
}

export const EU_COUNTRIES: Country[] = [
  { code: 'AT', name: 'Austria', eu: true },
  { code: 'BE', name: 'Belgium', eu: true },
  { code: 'BG', name: 'Bulgaria', eu: true },
  { code: 'HR', name: 'Croatia', eu: true },
  { code: 'CY', name: 'Cyprus', eu: true },
  { code: 'CZ', name: 'Czechia', eu: true },
  { code: 'DK', name: 'Denmark', eu: true },
  { code: 'EE', name: 'Estonia', eu: true },
  { code: 'FI', name: 'Finland', eu: true },
  { code: 'FR', name: 'France', eu: true },
  { code: 'DE', name: 'Germany', eu: true },
  { code: 'GR', name: 'Greece', eu: true },
  { code: 'HU', name: 'Hungary', eu: true },
  { code: 'IE', name: 'Ireland', eu: true },
  { code: 'IT', name: 'Italy', eu: true },
  { code: 'LV', name: 'Latvia', eu: true },
  { code: 'LT', name: 'Lithuania', eu: true },
  { code: 'LU', name: 'Luxembourg', eu: true },
  { code: 'MT', name: 'Malta', eu: true },
  { code: 'NL', name: 'Netherlands', eu: true },
  { code: 'PL', name: 'Poland', eu: true },
  { code: 'PT', name: 'Portugal', eu: true },
  { code: 'RO', name: 'Romania', eu: true },
  { code: 'SK', name: 'Slovakia', eu: true },
  { code: 'SI', name: 'Slovenia', eu: true },
  { code: 'ES', name: 'Spain', eu: true },
  { code: 'SE', name: 'Sweden', eu: true },
]

export const NON_EU_COUNTRIES: Country[] = [
  { code: 'GB', name: 'United Kingdom', eu: false },
  { code: 'CH', name: 'Switzerland', eu: false },
  { code: 'NO', name: 'Norway', eu: false },
  { code: 'IS', name: 'Iceland', eu: false },
  { code: 'US', name: 'United States', eu: false },
  { code: 'CA', name: 'Canada', eu: false },
  { code: 'AU', name: 'Australia', eu: false },
  { code: 'NZ', name: 'New Zealand', eu: false },
  { code: 'JP', name: 'Japan', eu: false },
]

export const ALL_COUNTRIES: Country[] = [...EU_COUNTRIES, ...NON_EU_COUNTRIES]

const COUNTRY_BY_CODE = new Map(ALL_COUNTRIES.map((c) => [c.code, c]))

export function countryName(code: string): string {
  return COUNTRY_BY_CODE.get(code)?.name ?? code
}

export function isEuCountry(code: string): boolean {
  return COUNTRY_BY_CODE.get(code)?.eu ?? false
}

/** Human labels for the 7 server-side company-registration registers (B2B). */
export const COMPANY_REG_TYPE_OPTIONS: { value: CompanyRegistrationType; label: string }[] = [
  { value: 'KVK', label: 'KvK (Netherlands)' },
  { value: 'HRB', label: 'Handelsregister / HRB (Germany)' },
  { value: 'SIREN', label: 'SIREN/SIRET (France)' },
  { value: 'KBO', label: 'KBO/BCE (Belgium)' },
  { value: 'CVR', label: 'CVR (Denmark)' },
  { value: 'ORGNR', label: 'Org.nr (Sweden/Norway)' },
  { value: 'OTHER', label: 'Other' },
]

/** Sensible default register for a billing country; user can override. */
export function defaultRegTypeForCountry(code: string): CompanyRegistrationType {
  switch (code) {
    case 'NL':
      return 'KVK'
    case 'DE':
      return 'HRB'
    case 'FR':
      return 'SIREN'
    case 'BE':
      return 'KBO'
    case 'DK':
      return 'CVR'
    case 'SE':
    case 'NO':
      return 'ORGNR'
    default:
      return 'OTHER'
  }
}
