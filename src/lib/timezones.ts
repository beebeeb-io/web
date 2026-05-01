export interface TimezoneEntry {
  value: string
  label: string
  region: string
}

const IANA_ZONES: Record<string, string[]> = {
  'Africa': [
    'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers',
    'Africa/Cairo', 'Africa/Casablanca', 'Africa/Ceuta', 'Africa/Dar_es_Salaam',
    'Africa/Johannesburg', 'Africa/Khartoum', 'Africa/Lagos', 'Africa/Maputo',
    'Africa/Monrovia', 'Africa/Nairobi', 'Africa/Ndjamena', 'Africa/Sao_Tome',
    'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek',
  ],
  'Americas': [
    'America/Adak', 'America/Anchorage', 'America/Argentina/Buenos_Aires',
    'America/Asuncion', 'America/Barbados', 'America/Belem', 'America/Bogota',
    'America/Boise', 'America/Cambridge_Bay', 'America/Cancun', 'America/Caracas',
    'America/Cayenne', 'America/Chicago', 'America/Chihuahua', 'America/Costa_Rica',
    'America/Cuiaba', 'America/Danmarkshavn', 'America/Dawson', 'America/Dawson_Creek',
    'America/Denver', 'America/Detroit', 'America/Edmonton', 'America/El_Salvador',
    'America/Fort_Nelson', 'America/Glace_Bay', 'America/Goose_Bay',
    'America/Grand_Turk', 'America/Guatemala', 'America/Guayaquil', 'America/Guyana',
    'America/Halifax', 'America/Havana', 'America/Hermosillo',
    'America/Indiana/Indianapolis', 'America/Indiana/Knox', 'America/Inuvik',
    'America/Iqaluit', 'America/Jamaica', 'America/Juneau',
    'America/Kentucky/Louisville', 'America/La_Paz', 'America/Lima',
    'America/Los_Angeles', 'America/Managua', 'America/Manaus',
    'America/Martinique', 'America/Matamoros', 'America/Mazatlan',
    'America/Menominee', 'America/Merida', 'America/Metlakatla',
    'America/Mexico_City', 'America/Miquelon', 'America/Moncton',
    'America/Monterrey', 'America/Montevideo', 'America/New_York',
    'America/Nome', 'America/Noronha', 'America/Nuuk', 'America/Ojinaga',
    'America/Panama', 'America/Paramaribo', 'America/Phoenix',
    'America/Port-au-Prince', 'America/Porto_Velho', 'America/Puerto_Rico',
    'America/Punta_Arenas', 'America/Rankin_Inlet', 'America/Recife',
    'America/Regina', 'America/Rio_Branco', 'America/Santiago',
    'America/Santo_Domingo', 'America/Sao_Paulo', 'America/Scoresbysund',
    'America/Sitka', 'America/St_Johns', 'America/Swift_Current',
    'America/Tegucigalpa', 'America/Thule', 'America/Tijuana',
    'America/Toronto', 'America/Vancouver', 'America/Whitehorse',
    'America/Winnipeg', 'America/Yakutat',
  ],
  'Antarctica': [
    'Antarctica/Casey', 'Antarctica/Davis', 'Antarctica/Macquarie',
    'Antarctica/Mawson', 'Antarctica/Palmer', 'Antarctica/Rothera',
    'Antarctica/Syowa', 'Antarctica/Troll', 'Antarctica/Vostok',
  ],
  'Asia': [
    'Asia/Almaty', 'Asia/Amman', 'Asia/Anadyr', 'Asia/Aqtau', 'Asia/Aqtobe',
    'Asia/Ashgabat', 'Asia/Atyrau', 'Asia/Baghdad', 'Asia/Baku', 'Asia/Bangkok',
    'Asia/Barnaul', 'Asia/Beirut', 'Asia/Bishkek', 'Asia/Brunei',
    'Asia/Chita', 'Asia/Colombo', 'Asia/Damascus', 'Asia/Dhaka',
    'Asia/Dili', 'Asia/Dubai', 'Asia/Dushanbe', 'Asia/Famagusta',
    'Asia/Gaza', 'Asia/Hebron', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong',
    'Asia/Hovd', 'Asia/Irkutsk', 'Asia/Jakarta', 'Asia/Jayapura',
    'Asia/Jerusalem', 'Asia/Kabul', 'Asia/Kamchatka', 'Asia/Karachi',
    'Asia/Kathmandu', 'Asia/Khandyga', 'Asia/Kolkata', 'Asia/Krasnoyarsk',
    'Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Macau', 'Asia/Magadan',
    'Asia/Makassar', 'Asia/Manila', 'Asia/Nicosia', 'Asia/Novokuznetsk',
    'Asia/Novosibirsk', 'Asia/Omsk', 'Asia/Oral', 'Asia/Pontianak',
    'Asia/Pyongyang', 'Asia/Qatar', 'Asia/Qostanay', 'Asia/Qyzylorda',
    'Asia/Riyadh', 'Asia/Sakhalin', 'Asia/Samarkand', 'Asia/Seoul',
    'Asia/Shanghai', 'Asia/Singapore', 'Asia/Srednekolymsk', 'Asia/Taipei',
    'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Tehran', 'Asia/Thimphu',
    'Asia/Tokyo', 'Asia/Tomsk', 'Asia/Ulaanbaatar', 'Asia/Urumqi',
    'Asia/Ust-Nera', 'Asia/Vladivostok', 'Asia/Yakutsk', 'Asia/Yangon',
    'Asia/Yekaterinburg', 'Asia/Yerevan',
  ],
  'Atlantic': [
    'Atlantic/Azores', 'Atlantic/Bermuda', 'Atlantic/Canary',
    'Atlantic/Cape_Verde', 'Atlantic/Faroe', 'Atlantic/Madeira',
    'Atlantic/South_Georgia', 'Atlantic/Stanley',
  ],
  'Australia': [
    'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Broken_Hill',
    'Australia/Darwin', 'Australia/Eucla', 'Australia/Hobart',
    'Australia/Lindeman', 'Australia/Lord_Howe', 'Australia/Melbourne',
    'Australia/Perth', 'Australia/Sydney',
  ],
  'Europe': [
    'Europe/Amsterdam', 'Europe/Andorra', 'Europe/Astrakhan', 'Europe/Athens',
    'Europe/Belgrade', 'Europe/Berlin', 'Europe/Brussels', 'Europe/Bucharest',
    'Europe/Budapest', 'Europe/Chisinau', 'Europe/Copenhagen', 'Europe/Dublin',
    'Europe/Gibraltar', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Kaliningrad',
    'Europe/Kirov', 'Europe/Kyiv', 'Europe/Lisbon', 'Europe/London',
    'Europe/Luxembourg', 'Europe/Madrid', 'Europe/Malta', 'Europe/Minsk',
    'Europe/Monaco', 'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris',
    'Europe/Prague', 'Europe/Riga', 'Europe/Rome', 'Europe/Samara',
    'Europe/Saratov', 'Europe/Simferopol', 'Europe/Sofia', 'Europe/Stockholm',
    'Europe/Tallinn', 'Europe/Tirane', 'Europe/Ulyanovsk', 'Europe/Vienna',
    'Europe/Vilnius', 'Europe/Volgograd', 'Europe/Warsaw', 'Europe/Zurich',
  ],
  'Indian': [
    'Indian/Chagos', 'Indian/Maldives', 'Indian/Mauritius',
  ],
  'Pacific': [
    'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Bougainville',
    'Pacific/Chatham', 'Pacific/Easter', 'Pacific/Efate', 'Pacific/Fakaofo',
    'Pacific/Fiji', 'Pacific/Galapagos', 'Pacific/Gambier',
    'Pacific/Guadalcanal', 'Pacific/Guam', 'Pacific/Honolulu',
    'Pacific/Kanton', 'Pacific/Kiritimati', 'Pacific/Kosrae',
    'Pacific/Kwajalein', 'Pacific/Marquesas', 'Pacific/Nauru',
    'Pacific/Niue', 'Pacific/Norfolk', 'Pacific/Noumea',
    'Pacific/Pago_Pago', 'Pacific/Palau', 'Pacific/Pitcairn',
    'Pacific/Port_Moresby', 'Pacific/Rarotonga', 'Pacific/Tahiti',
    'Pacific/Tarawa', 'Pacific/Tongatapu',
  ],
  'UTC': [
    'UTC',
  ],
}

function getOffset(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(Date.now()).find(p => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

function parseOffsetMinutes(offset: string): number {
  const m = offset.match(/([+-])(\d+)(?::(\d+))?/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2]) * 60 + parseInt(m[3] ?? '0'))
}

export function getTimezoneGroups(): { region: string; zones: TimezoneEntry[] }[] {
  return Object.entries(IANA_ZONES).map(([region, zones]) => ({
    region,
    zones: zones
      .map(tz => {
        const offset = getOffset(tz)
        const city = tz.split('/').pop()!.replace(/_/g, ' ')
        return { value: tz, label: `${offset} — ${city}`, region, offset }
      })
      .sort((a, b) => parseOffsetMinutes(a.offset) - parseOffsetMinutes(b.offset) || a.label.localeCompare(b.label)),
  }))
}
