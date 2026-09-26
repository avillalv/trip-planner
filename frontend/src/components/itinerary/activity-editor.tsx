import { ExternalLink } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { googleMapsUrl } from '@/lib/activity-meta'
import { useDeleteActivity, useUpdateActivity, type Activity, type Day } from '@/lib/api/itinerary'
import { ActivityFields } from './activity-fields'
import { draftFromActivity, toPatch, validateDraft } from './activity-form'
import { OpeningHours } from './place-details'

type Props = { tripId: number; days: Day[]; activity: Activity | null; onClose: () => void }

export function ActivityEditor({ tripId, days, activity, onClose }: Props) {
  return (
    <Dialog open={activity !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {/* Keyed so the form starts over from the activity each time it opens. */}
        {activity && <EditForm key={`${activity.id}-${activity.version}`} tripId={tripId} days={days} activity={activity} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({ tripId, days, activity, onDone }: { tripId: number; days: Day[]; activity: Activity; onDone: () => void }) {
  const [draft, setDraft] = useState(() => draftFromActivity(activity))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = useUpdateActivity(tripId)
  const remove = useDeleteActivity(tripId)
  const place = activity.place_data as { opening_hours?: string | null } | null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateDraft(draft)
    if (problem) return setError(problem)
    const patch = toPatch(draft, activity)
    if (Object.keys(patch).length === 1) return onDone()
    update.mutate(
      { activityId: activity.id, ...patch },
      {
        onSuccess: () => {
          toast.success('Saved')
          onDone()
        },
        onError: onDone,
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">Edit activity</DialogTitle>
        <DialogDescription className="sr-only">Change the name, day, times, or details.</DialogDescription>
      </DialogHeader>

      <form id="activity-form" onSubmit={submit} className="space-y-4" noValidate>
        <ActivityFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} days={days} />
        {(place?.opening_hours || activity.lat !== null) && (
          <div className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            {place?.opening_hours && <OpeningHours value={place.opening_hours} />}
            {activity.lat !== null && (
              <a
                href={googleMapsUrl({ name: activity.location_name ?? activity.title, address: activity.address, lat: activity.lat, lon: activity.lon })}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-brand underline-offset-2 hover:underline"
              >
                Open in Google Maps
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
      </form>

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" form="activity-form" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogFooter>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {activity.title}?</AlertDialogTitle>
            <AlertDialogDescription>It's removed from the itinerary on every device.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                remove.mutate(activity, {
                  onSuccess: () => {
                    toast.success(`${activity.title} deleted`)
                    onDone()
                  },
                  onError: onDone,
                })
              }
            >
              Delete activity
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
