import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PERSON_COLORS, nextPersonColor, usePeople, useSavePerson, type Person } from '@/lib/api/people'
import { cn } from '@/lib/utils'
import { AirportPicker } from './airport-picker'
import { PersonAvatar } from './person-avatar'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; person?: Person }

export function PersonEditor({ open, onOpenChange, person }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PersonForm person={person} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function PersonForm({ person, onDone }: { person?: Person; onDone: () => void }) {
  const people = usePeople()
  const save = useSavePerson(person?.id)
  const [name, setName] = useState(person?.name ?? '')
  const [color, setColor] = useState(person?.color ?? nextPersonColor(people.data ?? []))
  const [airports, setAirports] = useState<string[]>(person?.home_airports ?? [])
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Enter a name.')
    save.mutate(
      { name: name.trim(), color, home_airports: airports },
      {
        onSuccess: (saved) => {
          toast.success(person ? 'Traveler updated' : `Added ${saved.name}`)
          onDone()
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">{person ? 'Edit traveler' : 'Add traveler'}</DialogTitle>
        <DialogDescription>Home airports become the default origins for flight tracking.</DialogDescription>
      </DialogHeader>

      <div className="flex items-end gap-3">
        <PersonAvatar person={{ name: name || '?', color }} />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="person-name" className="font-semibold">
            Name
          </Label>
          <Input id="person-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold">Color</legend>
        <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
          {PERSON_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={color === swatch}
              aria-label={swatch}
              onClick={() => setColor(swatch)}
              className={cn(
                'size-7 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                color === swatch && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="person-airports" className="font-semibold">
          Home airports
        </Label>
        <AirportPicker inputId="person-airports" value={airports} onChange={setAirports} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : person ? 'Save' : 'Add traveler'}
        </Button>
      </DialogFooter>
    </form>
  )
}
