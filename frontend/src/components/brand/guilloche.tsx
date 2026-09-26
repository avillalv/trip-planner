import { useId, useMemo, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { BAND_VIEWBOX, ROSETTE_VIEWBOX, buildBand, buildRosette } from './guilloche-geometry'

type GuillocheProps = {
  /** Deterministic seed — use the trip id so each trip keeps its own pattern. */
  seed: string
  variant?: 'rosette' | 'band'
  /** Draw the linework on mount (skipped when the user prefers reduced motion). */
  animate?: boolean
  /** Line width in viewBox units (the rosette is 200 units across, the band 800×120). */
  strokeWidth?: number
  className?: string
}

/** Decorative per-trip security print. Purely visual, so it is hidden from assistive tech. */
export function Guilloche({ seed, variant = 'rosette', animate = false, strokeWidth, className }: GuillocheProps) {
  const gradientId = `guilloche-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const paths = useMemo(() => (variant === 'band' ? buildBand(seed) : buildRosette(seed)), [seed, variant])
  const viewBox = variant === 'band' ? `0 0 ${BAND_VIEWBOX.width} ${BAND_VIEWBOX.height}` : `0 0 ${ROSETTE_VIEWBOX} ${ROSETTE_VIEWBOX}`

  return (
    <svg
      viewBox={viewBox}
      // Bands crop rather than stretch so lines keep an even width.
      preserveAspectRatio={variant === 'band' ? 'xMidYMid slice' : 'xMidYMid meet'}
      aria-hidden="true"
      focusable="false"
      data-seed={seed}
      className={cn(animate && 'guilloche-animate', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--tp-line-a)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--tp-line-b)' }} />
          <stop offset="1" style={{ stopColor: 'var(--tp-line-c)' }} />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth ?? (variant === 'band' ? 0.9 : 0.5)}
        strokeLinejoin="round"
      >
        {/* pathLength=1 lets one dash span each curve for the draw-on animation. */}
        {paths.map((d, i) => (
          <path key={i} d={d} pathLength={1} style={{ '--i': i } as CSSProperties} />
        ))}
      </g>
    </svg>
  )
}
