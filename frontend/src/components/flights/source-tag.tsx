import { seriesFor, SOURCE_DESCRIPTIONS } from '@/lib/price-sources'

/** Source of a price: a colored key beside ink text (identity never rides on color alone). */
export function SourceTag({ source }: { source: string }) {
  const series = seriesFor(source)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft" title={SOURCE_DESCRIPTIONS[source]}>
      <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: series.color }} aria-hidden="true" />
      {series.short}
    </span>
  )
}
