import { X } from 'lucide-react'
import { useState } from 'react'
import { Combobox } from '@/components/common/combobox'
import { useAirportSearch } from '@/lib/api/lookup'
import { useDebouncedValue } from '@/lib/hooks'

type Props = { inputId: string; value: string[]; onChange: (codes: string[]) => void; max?: number }

/** Pick airports by code, city, or name; shows chosen codes like bag tags. */
export function AirportPicker({ inputId, value, onChange, max = 6 }: Props) {
  const [query, setQuery] = useState('')
  const search = useAirportSearch(useDebouncedValue(query, 200))
  const results = (search.data ?? []).filter((a) => !value.includes(a.iata))

  return (
    <div className="space-y-2">
      {value.length < max && (
        <Combobox
          inputId={inputId}
          placeholder="Airport code, city, or name"
          query={query}
          onQueryChange={setQuery}
          items={results}
          getKey={(a) => a.iata}
          loading={search.isFetching}
          emptyText="No airports match."
          onSelect={(a) => onChange([...value, a.iata])}
          renderItem={(a) => (
            <span className="flex items-baseline gap-2">
              <span className="type-code w-10 text-sm">{a.iata}</span>
              <span className="truncate">
                {a.city ? `${a.city} · ` : ''}
                <span className="text-ink-soft">{a.name}</span>
              </span>
            </span>
          )}
        />
      )}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen airports">
          {value.map((code) => (
            <li key={code} className="inline-flex items-center gap-1 rounded-md border bg-background py-0.5 pr-0.5 pl-2">
              <span className="type-code text-sm">{code}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((c) => c !== code))}
                className="grid size-5 place-items-center rounded text-ink-soft hover:bg-accent hover:text-foreground"
                aria-label={`Remove ${code}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
