import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useState } from 'react'
import { Combobox } from '@/components/common/combobox'
import { CountryTag } from '@/components/common/country-tag'
import { Button } from '@/components/ui/button'
import { useDestinationSearch, type DestinationSuggestion } from '@/lib/api/lookup'
import type { DestinationInput } from '@/lib/api/trips'
import { useDebouncedValue } from '@/lib/hooks'
import { placeLine } from '@/lib/trip-display'

function fromSuggestion(s: DestinationSuggestion): DestinationInput {
  return {
    name: s.name,
    region: s.region,
    country: s.country,
    country_code: s.country_code,
    kind: s.kind,
    lat: s.lat,
    lon: s.lon,
    timezone: s.timezone,
    bbox: s.bbox,
    geoapify_place_id: s.geoapify_place_id,
  }
}

const sameSpot = (a: { name: string; lat: number; lon: number }, b: { name: string; lat: number; lon: number }) =>
  a.name.toLowerCase() === b.name.toLowerCase() && Math.abs(a.lat - b.lat) < 0.2 && Math.abs(a.lon - b.lon) < 0.2

type Props = {
  inputId: string
  value: DestinationInput[]
  onChange: (next: DestinationInput[]) => void
}

export function DestinationPicker({ inputId, value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const search = useDestinationSearch(useDebouncedValue(query, 300))
  const results = (search.data ?? []).filter((s) => !value.some((d) => sameSpot(d, s)))

  const move = (index: number, delta: -1 | 1) => {
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <Combobox
        inputId={inputId}
        placeholder="Search for a city, region, or country"
        query={query}
        onQueryChange={setQuery}
        items={results}
        getKey={(s) => `${s.name}-${s.lat}-${s.lon}`}
        loading={search.isFetching}
        error={search.error ? search.error.message : null}
        emptyText="No places match. Try the full name."
        onSelect={(s) => onChange([...value, fromSuggestion(s)])}
        renderItem={(s) => (
          <span className="flex items-center gap-2">
            <CountryTag code={s.country_code} />
            <span className="font-semibold">{s.name}</span>
            <span className="truncate text-ink-soft">{placeLine(s)}</span>
          </span>
        )}
      />
      {value.length > 0 && (
        <ol className="divide-y rounded-lg border bg-background">
          {value.map((d, index) => (
            <li key={`${d.name}-${d.lat}-${d.lon}`} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
              <span className="type-data w-4 text-xs text-ink-soft">{index + 1}</span>
              <CountryTag code={d.country_code} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{d.name}</span>
                {placeLine(d) && <span className="text-ink-soft"> · {placeLine(d)}</span>}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${d.name} earlier`}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${d.name} later`}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`Remove ${d.name}`}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
