import { GripVertical, Lightbulb, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORY, tint } from '@/lib/activity-meta'
import type { Activity } from '@/lib/api/itinerary'
import { cn } from '@/lib/utils'

type Props = {
  ideas: Activity[]
  onOpen: (idea: Activity) => void
  /** Put an idea on the day being viewed (only in the day view). */
  onSchedule?: (idea: Activity) => void
  onAdd: () => void
  /** The list element, so the calendar can let its items be dragged onto the grid. */
  listRef?: (el: HTMLUListElement | null) => void
  className?: string
}

export function IdeasPanel({ ideas, onOpen, onSchedule, onAdd, listRef, className }: Props) {
  return (
    <section aria-labelledby="ideas-heading" className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ideas-heading" className="type-heading">
          Ideas <span className="type-data text-sm font-normal text-ink-soft">{ideas.length}</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add an idea
        </Button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        {onSchedule ? 'Drag one onto the day, or use + to add it.' : 'Things you might do. Open one to give it a day.'}
      </p>

      {ideas.length === 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-dashed p-4 text-sm text-ink-soft">
          <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Save places you might visit here, then fit them into days.
        </div>
      ) : (
        <ul ref={listRef} className="mt-3 min-h-0 space-y-2 overflow-y-auto">
          {ideas.map((idea) => {
            const { icon: Icon, color, label } = CATEGORY[idea.category]
            return (
              <li
                key={idea.id}
                data-idea-id={idea.id}
                data-title={idea.title}
                className={cn(
                  'group flex items-center gap-2 rounded-lg border bg-card py-2 pr-1 pl-2 text-sm',
                  onSchedule && 'cursor-grab active:cursor-grabbing',
                )}
                style={{ borderLeft: `3px solid ${color}`, backgroundColor: tint(color, 6) }}
              >
                {onSchedule && <GripVertical className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />}
                <Icon className="size-4 shrink-0" style={{ color }} aria-label={label} />
                <button
                  type="button"
                  onClick={() => onOpen(idea)}
                  className="min-w-0 flex-1 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="block truncate font-semibold">{idea.title}</span>
                  {idea.location_name && idea.location_name !== idea.title && (
                    <span className="block truncate text-xs text-ink-soft">{idea.location_name}</span>
                  )}
                </button>
                {onSchedule && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Add ${idea.title} to this day`}
                    onClick={() => onSchedule(idea)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
