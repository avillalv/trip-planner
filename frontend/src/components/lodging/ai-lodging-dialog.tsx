import { ExternalLink, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { AiRunOutcome, AiRunWorking } from '@/components/agents/ai-run-progress'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { isRunning } from '@/lib/api/agents'
import { errorMessage } from '@/lib/api/client'
import { useAskForLodging, type AskLodging } from '@/lib/api/lodging'
import { useLatestAiRun } from '@/lib/api/suggestions'
import type { Trip } from '@/lib/api/trips'
import { cn } from '@/lib/utils'
import { airbnbSearchUrl } from './lodging-meta'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trip: Trip
  /** Called from "Show AI picks", after this dialog closes, so the page can switch to its AI picks view. */
  onShowPicks: () => void
}

const KINDS: Array<{ value: NonNullable<AskLodging['kind']>; label: string }> = [
  { value: 'rentals', label: 'Vacation rentals' },
  { value: 'hotels', label: 'Hotels' },
]

export function AiLodgingDialog({ open, onOpenChange, trip, onShowPicks }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-2xl">
        {open && (
          <AiLodging
            trip={trip}
            onShowPicks={() => {
              onOpenChange(false)
              onShowPicks()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Only mounted while the dialog is open, so the run is only watched while someone looks. */
function AiLodging({ trip, onShowPicks }: { trip: Trip; onShowPicks: () => void }) {
  const first = trip.destinations[0]
  const [place, setPlace] = useState(first ? [first.name, first.country].filter(Boolean).join(', ') : '')
  const [checkIn, setCheckIn] = useState(trip.start_date ?? '')
  const [checkOut, setCheckOut] = useState(trip.end_date ?? '')
  const [guests, setGuests] = useState(String(Math.min(16, Math.max(1, trip.travelers.length || 2))))
  const [kind, setKind] = useState<NonNullable<AskLodging['kind']>>('rentals')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ask = useAskForLodging(trip.id)
  const { run, isPending } = useLatestAiRun(trip.id, 'lodging_agent')
  const working = run !== undefined && isRunning(run.status)
  const busy = working || isPending || ask.isPending
  const guestCount = Math.min(16, Math.max(1, Math.trunc(Number(guests)) || 2))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!checkIn || !checkOut || checkOut <= checkIn) return setError('Pick check-in and check-out dates.')
    setError(null)
    ask.mutate(
      {
        place: place.trim() || null,
        check_in: checkIn,
        check_out: checkOut,
        guests: guestCount,
        kind,
        message: message.trim() || null,
      },
      { onError: (e) => setError(errorMessage(e)) },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">Find the best places to stay</DialogTitle>
        <DialogDescription>
          Claude searches Google for your dates, reads the reviews, and saves its best picks to your list.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-lodging-place" className="text-sm font-semibold">
            Place
          </Label>
          <Input id="ai-lodging-place" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ai-lodging-in" className="text-sm font-semibold">
              Check-in
            </Label>
            <Input
              id="ai-lodging-in"
              type="date"
              min={trip.start_date ?? undefined}
              max={trip.end_date ?? undefined}
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-lodging-out" className="text-sm font-semibold">
              Check-out
            </Label>
            <Input
              id="ai-lodging-out"
              type="date"
              min={trip.start_date ?? undefined}
              max={trip.end_date ?? undefined}
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-lodging-guests" className="text-sm font-semibold">
              Guests
            </Label>
            <Input
              id="ai-lodging-guests"
              type="number"
              inputMode="numeric"
              min={1}
              max={16}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </div>
        </div>
        <div role="radiogroup" aria-label="What to look for" className="flex w-fit rounded-lg border p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                kind === k.value ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-soft hover:bg-accent',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-lodging-message" className="text-sm font-semibold">
            Anything to keep in mind?
          </Label>
          <Textarea
            id="ai-lodging-message"
            rows={3}
            maxLength={1000}
            placeholder="Walkable to a beach, near the volcano, under $200 a night, good for thrifting trips into town…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <p className="text-xs text-ink-soft">
          Uses one of this month’s Google searches. Claude then reads reviews and picks the best few for your interests.
        </p>
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          <Sparkles aria-hidden="true" />
          {ask.isPending ? 'Searching…' : 'Find the best places'}
        </Button>
      </form>

      {run && working && (
        <AiRunWorking
          run={run}
          hint="This usually takes a few minutes. You can close this window; picks appear on the page as Claude saves them."
        />
      )}
      {run && !working && (
        <>
          <AiRunOutcome run={run} label="Places to stay" />
          {(run.status === 'succeeded' || run.status === 'partial') && (
            <Button variant="outline" className="w-fit" onClick={onShowPicks}>
              Show AI picks
            </Button>
          )}
        </>
      )}

      <div className="space-y-1 border-t pt-3 text-sm">
        <a
          href={airbnbSearchUrl({ place, checkIn, checkOut, guests: guestCount })}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-brand underline-offset-2 hover:underline"
        >
          Search Airbnb for these dates
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
        <p className="text-ink-soft">
          The app can’t check Airbnb for you. Open it yourself, and save any listing you like with the bookmarklet.
        </p>
      </div>
    </>
  )
}
