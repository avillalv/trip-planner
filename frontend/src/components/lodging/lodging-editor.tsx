import { Link2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
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
import { Input } from '@/components/ui/input'
import {
  useAddLodging,
  useDeleteLodging,
  usePreviewLink,
  useUpdateLodging,
  type Lodging,
  type LodgingInput,
} from '@/lib/api/lodging'
import { useDebouncedValue } from '@/lib/hooks'
import { LodgingFields } from './lodging-fields'
import { draftFromLodging, newLodgingDraft, toLodgingInput, toLodgingPatch, validateLodging, type LodgingDraft } from './lodging-form'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripId: number
  /** Edit this option; otherwise add a new one. */
  option?: Lodging | null
  initial?: Partial<LodgingDraft>
  addedVia?: LodgingInput['added_via']
  raw?: Record<string, unknown>
  onSaved?: (option: Lodging) => void
}

export function LodgingEditor({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-2xl">
        {open && <EditorForm {...rest} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function EditorForm({
  tripId,
  option,
  initial,
  addedVia = 'manual',
  raw,
  onSaved,
  onDone,
}: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const editing = Boolean(option)
  const [draft, setDraft] = useState(() => (option ? draftFromLodging(option) : newLodgingDraft(initial)))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [source, setSource] = useState(addedVia)
  const add = useAddLodging(tripId)
  const update = useUpdateLodging(tripId)
  const remove = useDeleteLodging(tripId)
  const preview = usePreviewLink()
  const patch = (changes: Partial<LodgingDraft>) => setDraft((d) => ({ ...d, ...changes }))

  // A pasted link fills in the dates and party it carries, without fetching anything.
  const link = useDebouncedValue(draft.url.trim(), 500)
  const lastParsed = useRef('')
  useEffect(() => {
    if (editing || !/^https?:\/\/\S+\.\S+/i.test(link) || link === lastParsed.current) return
    lastParsed.current = link
    preview.mutate(
      { url: link },
      {
        onSuccess: (info) => {
          setSource((s) => (s === 'manual' ? 'paste' : s))
          // The link's own dates and party are more specific than the trip-wide defaults.
          setDraft((d) => ({
            ...d,
            checkIn: info.check_in ?? d.checkIn,
            checkOut: info.check_out ?? d.checkOut,
            guests: info.guests ? String(info.guests) : d.guests,
          }))
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, editing])

  const fetchPage = () =>
    preview.mutate(
      { url: draft.url.trim(), fetch: true },
      {
        onSuccess: (info) => {
          if (!info.fetched) {
            toast.warning(info.fetch_problem ?? 'The page couldn’t be read. Fill in the details yourself.')
            return
          }
          setDraft((d) => ({
            ...d,
            title: d.title || info.title || '',
            photos: d.photos.length ? d.photos : (info.photos ?? []),
            notes: d.notes || info.description || '',
          }))
        },
        onError: (e) => toast.error(e.message),
      },
    )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateLodging(draft)
    if (problem) return setError(problem)
    const onError = (e: Error) => setError(e.message)
    if (option) {
      update.mutate(
        { id: option.id, ...toLodgingPatch(draft, option) },
        {
          onSuccess: (saved) => {
            toast.success('Saved')
            onSaved?.(saved)
            onDone()
          },
          onError,
        },
      )
    } else {
      add.mutate(toLodgingInput(draft, source, raw), {
        onSuccess: (saved) => {
          toast.success(`${saved.title} added`)
          onSaved?.(saved)
          onDone()
        },
        onError,
      })
    }
  }

  const pending = add.isPending || update.isPending
  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">{editing ? 'Edit place to stay' : 'Add a place to stay'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Update the details, or mark how you feel about it.'
            : 'Paste the listing’s link to fill in its dates and guests, then add what the page shows.'}
        </DialogDescription>
      </DialogHeader>

      <form id="lodging-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="lodging-url" className="text-sm font-semibold">
            Link
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Link2 className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-soft" aria-hidden="true" />
              <Input
                id="lodging-url"
                type="url"
                inputMode="url"
                placeholder="https://www.airbnb.com/rooms/…"
                className="pl-8"
                value={draft.url}
                onChange={(e) => patch({ url: e.target.value })}
              />
            </div>
            {!editing && (
              <Button
                type="button"
                variant="outline"
                onClick={fetchPage}
                disabled={!/^https?:\/\/\S+\.\S+/i.test(draft.url.trim()) || preview.isPending}
                title="Reads the page's title and photo, once, like a chat app's link preview"
              >
                <Sparkles aria-hidden="true" />
                {preview.isPending ? 'Reading…' : 'Get title and photo'}
              </Button>
            )}
          </div>
          {!editing && (
            <p className="text-xs text-ink-soft">
              Many listing sites block previews; if so, type the details in. On a computer, the bookmarklet on this
              page captures them for you.
            </p>
          )}
        </div>

        <LodgingFields draft={draft} onChange={patch} />

        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
      </form>

      <DialogFooter className={editing ? 'sm:justify-between' : undefined}>
        {editing && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" form="lodging-form" disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save' : 'Add to list'}
          </Button>
        </div>
      </DialogFooter>

      {option && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {option.title}?</AlertDialogTitle>
              <AlertDialogDescription>It’s removed from the list, with its hearts and notes.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  remove.mutate(option.id, {
                    onSuccess: () => {
                      toast.success(`${option.title} removed`)
                      onDone()
                    },
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
