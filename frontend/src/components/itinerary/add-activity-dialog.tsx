import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCreateActivity, type Day, type Place } from '@/lib/api/itinerary'
import { ActivityFields } from './activity-fields'
import { newDraft, toInput, validateDraft, type ActivityDraft } from './activity-form'
import { shortDate } from './labels'
import { PlaceFinder, type SearchCenter } from './place-finder'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripId: number
  days: Day[]
  /** Where searches start (the day's city); without one, only "Add your own" is offered. */
  center: SearchCenter | null
  /** Day, times, and so on for the new activity (no day = an idea). */
  initial: Partial<ActivityDraft>
}

export function AddActivityDialog({ open, onOpenChange, tripId, days, center, initial }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[96dvh] overflow-y-auto sm:max-w-5xl">
        {open && (
          <AddActivity tripId={tripId} days={days} center={center} initial={initial} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddActivity({ tripId, days, center, initial, onDone }: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const create = useCreateActivity(tripId)
  const [draft, setDraft] = useState(() => newDraft(initial))
  const [error, setError] = useState<string | null>(null)
  const target = initial.day ? `${shortDate(initial.day)}` : 'your ideas'

  const save = (activityDraft: ActivityDraft, place?: Place) =>
    create.mutate(toInput(activityDraft, place), {
      onSuccess: (activity) => {
        toast.success(activity.day ? `Added to ${shortDate(activity.day)}` : 'Saved as an idea')
        onDone()
      },
      onError: (e) => (place ? toast.error(e.message) : setError(e.message)),
    })

  const submitOwn = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateDraft(draft)
    if (problem) return setError(problem)
    save(draft)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">Add to {target}</DialogTitle>
        <DialogDescription>
          {center ? `Find something near ${center.name}, or add your own.` : 'Add something to do.'}
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue={center ? 'find' : 'own'}>
        <TabsList>
          {center && <TabsTrigger value="find">Find a place</TabsTrigger>}
          <TabsTrigger value="own">Add your own</TabsTrigger>
        </TabsList>

        {center && (
          <TabsContent value="find">
            <PlaceFinder
              center={center}
              days={days}
              initial={initial}
              saving={create.isPending}
              onAdd={(place, placeDraft) => save(placeDraft, place)}
            />
          </TabsContent>
        )}

        <TabsContent value="own">
          <form id="own-activity" onSubmit={submitOwn} className="max-w-xl space-y-4" noValidate>
            <ActivityFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} days={days} />
            {error && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" form="own-activity" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : draft.day ? `Add to ${shortDate(draft.day)}` : 'Save as an idea'}
            </Button>
          </DialogFooter>
        </TabsContent>
      </Tabs>
    </>
  )
}
