import type { Person } from '@/lib/api/people'
import { cn } from '@/lib/utils'

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

export function PersonAvatar({
  person,
  size = 'md',
  className,
}: {
  person: Pick<Person, 'name' | 'color'>
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      title={person.name}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-bold text-white',
        size === 'sm' ? 'size-6 text-[0.6rem]' : 'size-8 text-xs',
        className,
      )}
      style={{ backgroundColor: person.color }}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  )
}

/** Overlapping avatars with the names available to screen readers. */
export function AvatarStack({ people, size = 'sm' }: { people: Person[]; size?: 'sm' | 'md' }) {
  if (people.length === 0) return null
  return (
    <span className="flex items-center">
      <span className="sr-only">Travelers: {people.map((p) => p.name).join(', ')}</span>
      {people.map((person, i) => (
        <PersonAvatar key={person.id} person={person} size={size} className={cn('ring-2 ring-card', i > 0 && '-ml-1.5')} />
      ))}
    </span>
  )
}
