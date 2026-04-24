export function BBLogo({ size = 16 }: { size?: number }) {
  return (
    <span style={{ fontSize: size }} className="font-bold tracking-tight text-ink">
      beebeeb<span className="text-amber">.io</span>
    </span>
  )
}
