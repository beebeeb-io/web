interface InfoRailProps {
  filename: string
  kind: string
  size: string
  items?: [string, string][]
}

export function InfoRail({ filename, kind, size, items = [] }: InfoRailProps) {
  const rows: [string, string][] = [
    ['Name', filename],
    ['Size', size],
    ['Kind', kind],
    ...items,
  ]

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Details section */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">
          Details
        </div>
        {rows.map(([label, value], i) => (
          <div
            key={i}
            className="flex border-b border-line py-[5px] text-xs"
          >
            <span className="w-[90px] shrink-0 text-ink-3">{label}</span>
            <span className="flex-1 break-all font-mono text-[11px] text-ink">
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Crypto section */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">
          Crypto
        </div>
        <div className="font-mono text-[11px] leading-[1.8] text-ink-2">
          XChaCha20-Poly1305
          <br />
          256-bit vault key
          <br />
          IV: 8f2e...91a3
          <br />
          MAC verified &#10003;
        </div>
      </div>
    </div>
  )
}
