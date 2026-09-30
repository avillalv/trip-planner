import { BedDouble, ExternalLink, Heart, Sparkles, Star } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useHeart, useUpdateLodging, type Lodging } from '@/lib/api/lodging'
import type { Person } from '@/lib/api/people'
import { formatDateRange } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { aiPickNotes, perPerson, STATUS, STATUS_ORDER } from './lodging-meta'
import { PhotoStrip } from './photo-strip'

type Props = {
  option: Lodging
  travelers: Person[]
  onEdit: (option: Lodging) => void
  comparing: boolean
  compareFull: boolean
  onToggleCompare: (option: Lodging) => void
}

function facts(option: Lodging): string[] {
  const out: string[] = []
  if (option.bedrooms !== null) out.push(`${option.bedrooms} ${option.bedrooms === 1 ? 'bedroom' : 'bedrooms'}`)
  if (option.beds !== null) out.push(`${option.beds} ${option.beds === 1 ? 'bed' : 'beds'}`)
  if (option.baths !== null) out.push(`${Number(option.baths)} ${Number(option.baths) === 1 ? 'bath' : 'baths'}`)
  return out
}

export function LodgingCard({ option, travelers, onEdit, comparing, compareFull, onToggleCompare }: Props) {
  const update = useUpdateLodging(option.trip_id)
  const heart = useHeart(option.trip_id)
  const home = option.home_currency
  const person = perPerson(option, travelers.length)
  const showOriginal = option.price_home_total !== null && option.currency !== home && option.price_total !== null
  const nights = option.nights
  const pick = option.added_via === 'agent' ? aiPickNotes(option.notes) : null
  const notes = pick ? pick.text : option.notes
  const [expanded, setExpanded] = useState(false)

  const save = (body: Parameters<typeof update.mutate>[0]) =>
    update.mutate(body, { onError: (e) => toast.error(e.message) })

  return (
    <li
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-card transition-opacity',
        option.status === 'rejected' && 'opacity-60',
        comparing && 'ring-2 ring-brand',
      )}
    >
      <div className="relative">
        <PhotoStrip photos={option.photos} title={option.title} />
        <button
          type="button"
          aria-pressed={option.favorite}
          aria-label={option.favorite ? 'Remove from favorites' : 'Mark as a favorite'}
          onClick={() => save({ id: option.id, favorite: !option.favorite })}
          className="absolute top-2 left-2 rounded-full bg-black/45 p-1.5 text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-white"
        >
          <Star className={cn('size-4', option.favorite && 'fill-amber-300 text-amber-300')} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          {pick && (
            <Badge variant="secondary" className="mb-1.5">
              <Sparkles aria-hidden="true" />
              {pick.rank ? `AI pick #${pick.rank}` : 'AI pick'}
            </Badge>
          )}
          <h3 className="line-clamp-2 leading-snug font-semibold">{option.title}</h3>
          <p className="text-sm text-ink-soft">
            {[
              option.site,
              option.check_in && option.check_out
                ? `${formatDateRange(option.check_in, option.check_out)} · ${nights} ${nights === 1 ? 'night' : 'nights'}`
                : null,
              option.guests ? `${option.guests} guests` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        {option.price_home_total !== null || option.price_total !== null ? (
          <div>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="type-data text-lg font-semibold">
                {formatMoney(option.price_home_total ?? option.price_total, option.price_home_total ? home : option.currency!)}
              </span>
              <span className="text-sm text-ink-soft">total</span>
              {showOriginal && (
                <span className="type-data text-xs text-ink-soft">({formatMoney(option.price_total, option.currency!)})</span>
              )}
            </p>
            <p className="text-sm text-ink-soft">
              {[
                option.price_per_night !== null && option.currency
                  ? `${formatMoney(option.price_per_night, option.currency)} a night`
                  : null,
                person !== null ? `${formatMoney(person, home)} per person` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">No price yet</p>
        )}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {option.rating !== null && (
            <span className="flex items-center gap-1">
              <Star className="size-3.5 fill-current text-amber-500" aria-hidden="true" />
              <span className="type-data">{Number(option.rating).toFixed(Number(option.rating) % 1 ? 2 : 1)}</span>
              {option.review_count !== null && <span className="text-ink-soft">({option.review_count})</span>}
            </span>
          )}
          {facts(option).length > 0 && (
            <span className="flex items-center gap-1 text-ink-soft">
              <BedDouble className="size-3.5" aria-hidden="true" />
              {facts(option).join(' · ')}
            </span>
          )}
        </p>

        {notes && (
          <div className="text-sm text-ink-soft">
            <p className={cn(!expanded && (pick ? 'line-clamp-4' : 'line-clamp-2'))}>{notes}</p>
            {pick && notes.length > 200 && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
                className="font-semibold text-brand underline-offset-2 hover:underline"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {(option.pros || option.cons) && (
          <div className="space-y-0.5 text-sm">
            {option.pros && (
              <p>
                <span className="font-semibold text-success" aria-hidden="true">
                  +
                </span>
                <span className="sr-only">Pros: </span> {option.pros}
              </p>
            )}
            {option.cons && (
              <p>
                <span className="font-semibold text-destructive" aria-hidden="true">
                  −
                </span>
                <span className="sr-only">Cons: </span> {option.cons}
              </p>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-1" aria-label="Hearts">
            {travelers.map((traveler) => {
              const on = option.hearts.includes(traveler.id)
              return (
                <button
                  key={traveler.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${on ? 'Remove' : 'Add'} ${traveler.name}’s heart`}
                  title={traveler.name}
                  onClick={() =>
                    heart.mutate(
                      { id: option.id, personId: traveler.id, hearted: !on },
                      { onError: (e) => toast.error(e.message) },
                    )
                  }
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs outline-offset-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Heart
                    className="size-3.5"
                    style={on ? { color: traveler.color, fill: traveler.color } : { color: traveler.color }}
                    aria-hidden="true"
                  />
                  {traveler.name.slice(0, 1)}
                </button>
              )
            })}
          </div>
          <select
            aria-label="Status"
            value={option.status}
            onChange={(e) => save({ id: option.id, status: e.target.value as Lodging['status'] })}
            className={cn('h-8 rounded-lg border border-input bg-card px-2 text-sm', STATUS[option.status].tone)}
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS[status].label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {option.url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={option.url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                Open listing
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onEdit(option)}>
            Edit
          </Button>
          <label className="ml-auto flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--tp-brand)]"
              checked={comparing}
              disabled={!comparing && compareFull}
              onChange={() => onToggleCompare(option)}
            />
            Compare
          </label>
        </div>
      </div>
    </li>
  )
}
