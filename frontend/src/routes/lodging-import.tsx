import { BedDouble } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { draftFromCapture } from '@/components/lodging/lodging-form'
import { LodgingEditor } from '@/components/lodging/lodging-editor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTrips } from '@/lib/api/trips'
import { readLastTripId } from '@/lib/last-trip'

export function LodgingImport() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const trips = useTrips()
  const list = (trips.data ?? []).filter((t) => t.status !== 'archived')
  const remembered = readLastTripId()
  const [tripId, setTripId] = useState<number | null>(null)
  const chosen = tripId ?? list.find((t) => t.id === remembered)?.id ?? list[0]?.id ?? null
  const trip = list.find((t) => t.id === chosen)
  const [open, setOpen] = useState(true)

  if (trips.isPending) {
    return (
      <div className="mx-auto max-w-xl space-y-3 px-4 py-10">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-10">
      <div>
        <h1 className="type-title flex items-center gap-2">
          <BedDouble className="size-7 text-brand" aria-hidden="true" />
          Save a place to stay
        </h1>
        <p className="mt-2 text-ink-soft">
          {params.get('title') ? (
            <>
              From <span className="font-semibold text-foreground">{params.get('title')}</span>. Check the details,
              then save it to a trip.
            </>
          ) : (
            'Nothing was captured. Open a listing, then click the bookmark again.'
          )}
        </p>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-ink-soft">Create a trip first, then save places to it.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1.5 text-sm">
            <span className="font-semibold">Trip</span>
            <select
              value={chosen ?? ''}
              onChange={(e) => setTripId(Number(e.target.value))}
              className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm"
            >
              {list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => setOpen(true)} disabled={!trip}>
            Review and save
          </Button>
        </div>
      )}

      {trip && (
        <LodgingEditor
          // A new form when the trip changes, so its currency and party follow.
          key={trip.id}
          open={open}
          onOpenChange={setOpen}
          tripId={trip.id}
          initial={draftFromCapture(params, trip)}
          addedVia="bookmarklet"
          raw={Object.fromEntries(params)}
          onSaved={() => navigate(`/trips/${trip.id}/lodging`)}
        />
      )}
    </div>
  )
}
