import { Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSetInterests } from '@/lib/api/trips'
import {
  addInterests,
  hasInterest,
  MAX_INTEREST_LENGTH,
  MAX_INTERESTS,
  SUGGESTED_INTERESTS,
} from '@/lib/interests'
import { cn } from '@/lib/utils'

type Props = {
  tripId: number
  /** The trip's current interests; changes show here at once and save as they're made. */
  interests: string[]
  className?: string
}

/** What the travelers enjoy: removable chips, a field that adds on Enter or a comma, and one-click suggestions. */
export function InterestsEditor({ tripId, interests, className }: Props) {
  const save = useSetInterests(tripId)
  const [draft, setDraft] = useState('')
  const full = interests.length >= MAX_INTERESTS
  const suggestions = SUGGESTED_INTERESTS.filter((s) => !hasInterest(interests, s))

  const update = (next: string[]) => {
    if (next.length === interests.length && next.every((x, i) => x === interests[i])) return
    save.mutate(next, { onError: (error) => toast.error(error.message) })
  }
  const add = (entries: string[]) => update(addInterests(interests, entries))

  const change = (value: string) => {
    if (!value.includes(',')) return setDraft(value)
    const parts = value.split(',')
    add(parts.slice(0, -1))
    setDraft(parts[parts.length - 1])
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    add([draft])
    setDraft('')
  }

  return (
    <div className={cn('space-y-3', className)}>
      {interests.length > 0 && (
        <ul aria-label="Interests" className="flex flex-wrap gap-1.5">
          {interests.map((interest) => (
            <li
              key={interest}
              className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft py-0.5 pr-0.5 pl-2.5 text-sm"
            >
              {interest}
              <button
                type="button"
                aria-label={`Remove ${interest}`}
                onClick={() => update(interests.filter((x) => x !== interest))}
                className="grid size-5 place-items-center rounded-full text-ink-soft outline-offset-1 hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="Add an interest"
          placeholder="Add an interest, like “beaches” or “ATV tours”"
          value={draft}
          maxLength={MAX_INTEREST_LENGTH}
          disabled={full}
          onChange={(e) => change(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={full || !draft.trim()}>
          Add
        </Button>
      </form>
      {full ? (
        <p className="text-xs text-ink-soft">
          That's the most interests a trip can have ({MAX_INTERESTS}). Remove one to add another.
        </p>
      ) : (
        suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                aria-label={`Add ${suggestion}`}
                onClick={() => add([suggestion])}
                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-sm text-ink-soft outline-offset-1 hover:border-solid hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Plus className="size-3" aria-hidden="true" />
                {suggestion}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}
