import { X } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useDismissNote, useTripNotes } from '@/lib/api/agents'
import { timeAgo } from '@/lib/format'
import { NoteCard } from './run-outputs'

/** Notes that research agents saved for this trip. Hidden until there are some. */
export function TripFindings({ tripId }: { tripId: number }) {
  const notes = useTripNotes(tripId)
  const dismiss = useDismissNote(tripId)
  if (!notes.data || notes.data.length === 0) return null

  return (
    <section aria-labelledby="findings-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="findings-heading" className="type-heading">
          Found by agents
        </h2>
        <Link to={`/agents?trip=${tripId}`} className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
          Manage agents
        </Link>
      </div>
      <ul className="space-y-3">
        {notes.data.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            action={
              <span className="flex shrink-0 items-center gap-1 text-xs text-ink-soft">
                {note.run_id ? (
                  <Link to={`/agents/runs/${note.run_id}`} className="hover:text-foreground hover:underline">
                    {timeAgo(note.created_at)}
                  </Link>
                ) : (
                  timeAgo(note.created_at)
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Dismiss “${note.title}”`}
                  onClick={() => dismiss.mutate(note.id, { onError: (e) => toast.error(e.message) })}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            }
          />
        ))}
      </ul>
    </section>
  )
}
