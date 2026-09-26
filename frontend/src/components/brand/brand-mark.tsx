import { useId } from 'react'
import { cn } from '@/lib/utils'

/** The app's mark: a six-petal rosette that stays crisp at icon sizes. */
export function BrandMark({ className }: { className?: string }) {
  const gradientId = `brand-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={cn('shrink-0', className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--tp-line-a)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--tp-line-b)' }} />
          <stop offset="1" style={{ stopColor: 'var(--tp-line-c)' }} />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeWidth="2">
        {[0, 30, 60, 90, 120, 150].map((angle) => (
          <ellipse key={angle} cx="32" cy="32" rx="28" ry="10" transform={`rotate(${angle} 32 32)`} />
        ))}
      </g>
    </svg>
  )
}
