import { Icon } from './icons'

export interface BreadcrumbItem {
  id: string | null
  name: string
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  onNavigate: (index: number) => void
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      {items.map((crumb, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <Icon name="chevron-right" size={12} className="text-ink-4" />}
            {isLast ? (
              <span className="font-semibold text-ink">{crumb.name}</span>
            ) : (
              <button
                onClick={() => onNavigate(i)}
                className="text-ink-3 hover:text-ink transition-colors cursor-pointer"
              >
                {crumb.name}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
