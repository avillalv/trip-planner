import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { PersonAvatar } from '@/components/people/person-avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nextPersonColor, usePeople, useSavePerson } from '@/lib/api/people'
import { cn } from '@/lib/utils'

type Props = { selected: number[]; onChange: (ids: number[]) => void }

export function TravelerPicker({ selected, onChange }: Props) {
  const people = usePeople()
  const createPerson = useSavePerson()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  const add = () => {
    if (!name.trim()) return
    createPerson.mutate(
      { name: name.trim(), color: nextPersonColor(people.data ?? []), home_airports: [] },
      {
        onSuccess: (person) => {
          onChange([...selected, person.id])
          setName('')
          setAdding(false)
        },
      },
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(people.data ?? []).map((person) => {
          const on = selected.includes(person.id)
          return (
            <button
              key={person.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(person.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                on ? 'border-brand bg-brand-soft font-semibold' : 'bg-background hover:bg-accent',
              )}
            >
              <PersonAvatar person={person} size="sm" />
              {person.name}
              {on && <Check className="size-3.5 text-brand" aria-hidden="true" />}
            </button>
          )
        })}
        {!adding && (
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add traveler
          </Button>
        )}
      </div>
      {adding && (
        // Not a <form>: this sits inside the trip form, and nested forms aren't allowed.
        <div
          className="flex gap-2"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault() // don't submit the surrounding trip form
            add()
          }}
        >
          <Input
            autoFocus
            aria-label="New traveler's name"
            placeholder="Name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="button" onClick={add} disabled={!name.trim() || createPerson.isPending}>
            Add
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
      {createPerson.error && <p className="text-sm text-destructive">{createPerson.error.message}</p>}
    </div>
  )
}
