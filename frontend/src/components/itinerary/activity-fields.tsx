import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORY, CATEGORY_ORDER } from '@/lib/activity-meta'
import type { Day } from '@/lib/api/itinerary'
import { cn } from '@/lib/utils'
import type { ActivityDraft } from './activity-form'
import { dayOptionLabel } from './labels'

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </Label>
      {children}
    </div>
  )
}

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

type Props = {
  draft: ActivityDraft
  onChange: (patch: Partial<ActivityDraft>) => void
  days: Day[]
  /** Leave out the name and place fields (when they come from a place). */
  compact?: boolean
}

export function ActivityFields({ draft, onChange, days, compact = false }: Props) {
  const timed = Boolean(draft.day) && !draft.anyTime
  return (
    <div className="space-y-4">
      {!compact && (
        <Field label="Name" htmlFor="activity-title">
          <Input
            id="activity-title"
            value={draft.title}
            maxLength={200}
            placeholder="Lunch at Nishiki Market"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </Field>
      )}

      {!compact && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Kind</legend>
          <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
            {CATEGORY_ORDER.map((category) => {
              const { label, icon: Icon, color } = CATEGORY[category]
              const selected = draft.category === category
              return (
                <button
                  key={category}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ category })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                    selected ? 'border-current font-semibold' : 'hover:bg-accent',
                  )}
                  style={selected ? { color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--card))` } : undefined}
                >
                  <Icon className="size-3.5" aria-hidden="true" style={{ color }} />
                  <span className={selected ? 'text-foreground' : undefined}>{label}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      <Field label="Day" htmlFor="activity-day">
        <select
          id="activity-day"
          className={selectClass}
          value={draft.day}
          onChange={(e) => onChange({ day: e.target.value })}
        >
          <option value="">No day yet (save as an idea)</option>
          {days.map((day) => (
            <option key={day.day} value={day.day}>
              {dayOptionLabel(day)}
            </option>
          ))}
        </select>
      </Field>

      {draft.day && (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="font-semibold">Any time that day</span>
            <Switch checked={draft.anyTime} onCheckedChange={(anyTime) => onChange({ anyTime })} />
          </label>
          {timed && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts" htmlFor="activity-start">
                <Input
                  id="activity-start"
                  type="time"
                  step={900}
                  value={draft.start}
                  onChange={(e) => onChange({ start: e.target.value })}
                />
              </Field>
              <Field label="Ends" htmlFor="activity-end">
                <Input
                  id="activity-end"
                  type="time"
                  step={900}
                  value={draft.end}
                  onChange={(e) => onChange({ end: e.target.value })}
                />
              </Field>
            </div>
          )}
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-semibold">Booked</span>
              <span className="block text-xs text-ink-soft">Tickets or a reservation are confirmed.</span>
            </span>
            <Switch checked={draft.booked} onCheckedChange={(booked) => onChange({ booked })} />
          </label>
        </div>
      )}

      {!compact && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Place (optional)" htmlFor="activity-location">
            <Input
              id="activity-location"
              value={draft.locationName}
              maxLength={200}
              onChange={(e) => onChange({ locationName: e.target.value })}
            />
          </Field>
          <Field label="Address (optional)" htmlFor="activity-address">
            <Input
              id="activity-address"
              value={draft.address}
              maxLength={500}
              onChange={(e) => onChange({ address: e.target.value })}
            />
          </Field>
        </div>
      )}

      {!compact && (
        <Field label="Link (optional)" htmlFor="activity-url">
          <Input
            id="activity-url"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
          />
        </Field>
      )}

      <Field label="Notes (optional)" htmlFor="activity-notes">
        <Textarea
          id="activity-notes"
          rows={2}
          maxLength={4000}
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>
    </div>
  )
}
