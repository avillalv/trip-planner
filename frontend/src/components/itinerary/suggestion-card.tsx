import { Clock, MapPin, X } from 'lucide-react'
import { SourceLink } from '@/components/agents/run-outputs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CATEGORY, tint } from '@/lib/activity-meta'
import type { Suggestion } from '@/lib/api/suggestions'
import { hostOf } from '@/lib/format'
import { monthAndDay, suggestionWhen } from './labels'

type Props = {
  suggestion: Suggestion
  /** True while this card's own request is in flight. */
  busy: boolean
  onAdd: (asIdea: boolean) => void
  onDismiss: () => void
}

export function SuggestionCard({ suggestion: s, busy, onAdd, onDismiss }: Props) {
  const { icon: Icon, color, label } = CATEGORY[s.category]
  return (
    <li
      className="rounded-xl border bg-card p-4"
      style={{ borderLeft: `3px solid ${color}`, backgroundColor: tint(color, 6) }}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" style={{ color }} aria-label={label} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="leading-snug font-semibold">{s.title}</h4>
            {s.mode === 'surprise' && <Badge variant="secondary">Surprise</Badge>}
          </div>
          <p className="type-data text-xs text-ink-soft">{suggestionWhen(s)}</p>
          {s.location_name && (
            <p className="flex items-center gap-1 text-sm text-ink-soft">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              {s.location_name}
            </p>
          )}
          <p className="text-sm">{s.description}</p>
          {s.why && <p className="text-sm text-ink-soft">{s.why}</p>}
          {s.timing_note && (
            <p className="flex items-start gap-1.5 text-sm">
              <Clock className="mt-0.5 size-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
              {s.timing_note}
            </p>
          )}
          {(s.url || s.sources.length > 0) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {s.url && <SourceLink url={s.url} />}
              {s.sources.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                  Sources
                  {s.sources.map((source, i) => (
                    <a
                      key={source}
                      href={source}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Source ${i + 1}, ${hostOf(source)}`}
                      title={hostOf(source)}
                      className="grid size-5 place-items-center rounded-full border font-semibold text-brand hover:bg-background"
                    >
                      {i + 1}
                    </a>
                  ))}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => onAdd(false)}>
          {s.day ? `Add to ${monthAndDay(s.day)}` : 'Add as an idea'}
        </Button>
        {s.day && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAdd(true)}>
            Save as idea
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          disabled={busy}
          aria-label={`Dismiss ${s.title}`}
          title="Dismiss"
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}
