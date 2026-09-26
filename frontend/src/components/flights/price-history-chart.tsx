import { useState, type Key } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import type { RouteHistory } from '@/lib/api/flights'
import { formatMoney } from '@/lib/money'
import { PRICE_SERIES } from '@/lib/price-sources'
import { cn } from '@/lib/utils'
import { historyRows, seriesPresent, type HistoryRow } from './history-data'
import { formatShortDate } from './route-text'

const DENSE_POINTS = 12

type TooltipProps = {
  active?: boolean
  label?: string
  payload?: Array<{ dataKey?: string | number; value?: number }>
  currency: string
}

/** Values lead, names follow; line keys instead of boxes. */
function HistoryTooltip({ active, label, payload, currency }: TooltipProps) {
  if (!active || !payload?.length || !label) return null
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value]))
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 text-xs text-ink-soft">{formatShortDate(label)}</p>
      <ul className="space-y-0.5">
        {PRICE_SERIES.filter((s) => byKey.get(s.key) !== undefined).map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
            <span className="type-data font-bold">{formatMoney(byKey.get(s.key), currency)}</span>
            <span className="text-ink-soft">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HistoryTable({ rows, keys, currency }: { rows: HistoryRow[]; keys: typeof PRICE_SERIES[number][]; currency: string }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">Cheapest price per day by source</caption>
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-left text-xs text-ink-soft">
            <th scope="col" className="px-3 py-2 font-semibold">Day</th>
            {keys.map((s) => (
              <th key={s.key} scope="col" className="px-3 py-2 text-right font-semibold">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.day}>
              <th scope="row" className="px-3 py-1.5 text-left font-normal">{formatShortDate(row.day)}</th>
              {keys.map((s) => (
                <td key={s.key} className="type-data px-3 py-1.5 text-right">{formatMoney(row[s.key], currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PriceHistoryChart({ history, dimmed }: { history: RouteHistory; dimmed?: boolean }) {
  const [asTable, setAsTable] = useState(false)
  const rows = historyRows(history)
  const present = seriesPresent(rows)
  const series = PRICE_SERIES.filter((s) => present.has(s.key))
  const currency = history.currency
  const low = history.typical_low !== null ? Number(history.typical_low) : null
  const high = history.typical_high !== null ? Number(history.typical_high) : null

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-soft">The trend appears after the first price check.</p>
  }

  return (
    <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Legend: always present for two or more series, keyed like the marks (lines). */}
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Legend">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                {s.label}
              </li>
            ))}
            {low !== null && high !== null && (
              <li className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm" style={{ backgroundColor: 'var(--viz-band)' }} aria-hidden="true" />
                Google's typical range
              </li>
            )}
          </ul>
        ) : (
          <p className="text-xs text-ink-soft">Cheapest {series[0]?.label} price each day</p>
        )}
        <Button variant="ghost" size="xs" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show as table'}
        </Button>
      </div>

      {asTable ? (
        <HistoryTable rows={rows} keys={series} currency={currency} />
      ) : (
        <div className="h-64" role="img" aria-label={`Price trend over ${rows.length} days`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--tp-rule)" />
              {low !== null && high !== null && (
                <ReferenceArea y1={low} y2={high} fill="var(--viz-band)" fillOpacity={1} stroke="none" ifOverflow="extendDomain" />
              )}
              <XAxis
                dataKey="day"
                tickFormatter={formatShortDate}
                tick={{ fill: 'var(--tp-ink-soft)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--tp-rule)' }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v: number) => formatMoney(v, currency, true)}
                tick={{ fill: 'var(--tp-ink-soft)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={64}
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={<HistoryTooltip currency={currency} />}
                cursor={{ stroke: 'var(--tp-ink-soft)', strokeWidth: 1 }}
              />
              {series.map((s) => {
                const indexes = rows.flatMap((row, i) => (row[s.key] === undefined ? [] : [i]))
                // Dense series read as a line: dots only on sparse ones, plus the latest value.
                const dense = indexes.length > DENSE_POINTS
                const last = indexes.at(-1)
                return (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={(props: { cx?: number; cy?: number; index?: number; key?: Key | null }) =>
                      (!dense || props.index === last) && props.cx !== undefined && props.cy !== undefined ? (
                        <circle key={props.key ?? undefined} cx={props.cx} cy={props.cy} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                      ) : (
                        <g key={props.key ?? undefined} />
                      )
                    }
                    activeDot={{ r: 5, fill: s.color, stroke: 'var(--card)', strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
