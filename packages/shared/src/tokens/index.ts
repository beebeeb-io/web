export const beebeebTailwindPreset = {
  theme: {
    extend: {
      colors: {
        paper: 'oklch(0.985 0.004 85)',
        'paper-2': 'oklch(0.968 0.006 85)',
        'paper-3': 'oklch(0.94 0.008 82)',
        line: 'oklch(0.90 0.008 82)',
        'line-2': 'oklch(0.85 0.01 80)',
        ink: 'oklch(0.18 0.01 70)',
        'ink-2': 'oklch(0.38 0.01 72)',
        'ink-3': 'oklch(0.52 0.01 78)',
        'ink-4': 'oklch(0.68 0.008 80)',
        amber: 'oklch(0.82 0.17 84)',
        'amber-deep': 'oklch(0.52 0.14 72)',
        'amber-bg': 'oklch(0.96 0.04 88)',
        green: 'oklch(0.72 0.16 155)',
        red: 'oklch(0.62 0.21 25)',
        'green-bg': 'oklch(0.94 0.06 155)',
        'green-border': 'oklch(0.85 0.09 155)',
        'red-bg': 'oklch(0.97 0.02 25)',
        'red-border': 'oklch(0.88 0.05 25)',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '18px',
        xl: '24px',
        '2xl': '36px',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '10px',
        xl: '14px',
      },
      boxShadow: {
        '1': '0 1px 3px oklch(0.18 0.01 70 / 0.04), 0 1px 2px oklch(0.18 0.01 70 / 0.06)',
        '2': '0 4px 12px oklch(0.18 0.01 70 / 0.06), 0 2px 4px oklch(0.18 0.01 70 / 0.04)',
        '3': '0 12px 32px oklch(0.18 0.01 70 / 0.1), 0 4px 8px oklch(0.18 0.01 70 / 0.04)',
      },
    },
  },
} as const

export const beebeebTokens = beebeebTailwindPreset.theme.extend
