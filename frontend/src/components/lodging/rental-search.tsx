import { Check, Search, Star } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useSerpApiUsage } from '@/lib/api/flights'
import { useAddLodging, useRentalSearch, type RentalOffer } from '@/lib/api/lodging'
import type { Trip } from '@/lib/api/trips'
import { formatMoney } from '@/lib/money'
import { PhotoStrip } from './photo-strip'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; trip: Trip; savedUrls: Set<string> }

export function RentalSearchDialog({ open, onOpenChange, trip, savedUrls }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-5xl">
        {open && <RentalSearch trip={trip} savedUrls={savedUrls} />}
      </DialogContent>
    </Dialog>
  )
}

function RentalSearch({ trip, savedUrls }: { trip: Trip; savedUrls: Set<string> }) {
  const first = trip.destinations[0]
  const [place, setPlace] = useState(first ? [first.name, first.country].filter(Boolean).join(', ') : '')
  const [checkIn, setCheckIn] = useState(trip.start_date ?? '')
  const [checkOut, setCheckOut] = useState(trip.end_date ?? '')
  const [adults, setAdults] = useState(String(Math.max(1, trip.travelers.length || 2)))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(() => new Set())
  const search = useRentalSearch(trip.id)
  const add = useAddLodging(trip.id)
  const usage = useSerpApiUsage()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!place.trim()) return setError('Say where to look.')
    if (!checkIn || !checkOut || checkOut <= checkIn) return setError('Pick check-in and check-out dates.')
    setError(null)
    search.mutate(
      { place: place.trim(), check_in: checkIn, check_out: checkOut, adults: Number(adults) || 2, children: 0 },
      { onError: (e) => setError(e.message) },
    )
  }

  const keep = (offer: RentalOffer) =>
    add.mutate(
      {
        title: offer.title,
        url: offer.link,
        check_in: checkIn,
        check_out: checkOut,
        guests: Number(adults) || null,
        price_total: offer.price_total,
        price_per_night: offer.price_total ? null : offer.price_per_night,
        currency: offer.price_total || offer.price_per_night ? offer.currency : null,
        photos: offer.photos,
        location_name: place.trim(),
        lat: offer.lat,
        lon: offer.lon,
        bedrooms: offer.bedrooms,
        beds: offer.beds,
        baths: offer.baths,
        rating: offer.rating,
        review_count: offer.review_count,
        notes: offer.details.join(' · '),
        added_via: 'serpapi',
        raw: offer,
      },
      {
        onSuccess: () => {
          setSaved((s) => new Set(s).add(offer.property_token ?? offer.title))
          toast.success(`${offer.title} added to the list`)
        },
        onError: (e) => toast.error(e.message),
      },
    )

  const offers = search.data?.offers ?? []
  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">Search vacation rentals</DialogTitle>
        <DialogDescription>
          Priced rentals from Google Hotels’ partners for your dates. Airbnb listings may not show up here; save those
          with the bookmarklet or a link.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="rental-place" className="text-sm font-semibold">
            Where
          </Label>
          <Input id="rental-place" value={place} onChange={(e) => setPlace(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rental-in" className="text-sm font-semibold">
            Check-in
          </Label>
          <Input id="rental-in" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rental-out" className="text-sm font-semibold">
            Check-out
          </Label>
          <Input id="rental-out" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rental-adults" className="text-sm font-semibold">
            Guests
          </Label>
          <Input id="rental-adults" inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} />
        </div>
        <Button type="submit" disabled={search.isPending}>
          <Search aria-hidden="true" />
          {search.isPending ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <p className="text-xs text-ink-soft">
        Each new search uses one of this month’s live searches, shared with flight price checks
        {usage.data && ` (${Math.max(0, usage.data.monthly_cap - usage.data.used_this_month)} left)`}. Repeating the
        same search within 12 hours is free.
      </p>

      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      {search.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : search.data && offers.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-soft">No rentals found for those dates. Try other dates or a nearby town.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer) => {
            const key = offer.property_token ?? offer.title
            const isSaved = saved.has(key) || Boolean(offer.link && savedUrls.has(offer.link))
            return (
              <li key={key} className="flex flex-col overflow-hidden rounded-xl border bg-card">
                <PhotoStrip photos={offer.photos} title={offer.title} />
                <div className="flex flex-1 flex-col gap-1.5 p-3 text-sm">
                  <p className="line-clamp-2 font-semibold">{offer.title}</p>
                  <p className="text-ink-soft">
                    {[offer.kind, offer.sleeps ? `sleeps ${offer.sleeps}` : null, offer.site].filter(Boolean).join(' · ')}
                  </p>
                  <p>
                    {offer.price_total !== null && (
                      <span className="type-data text-base font-semibold">{formatMoney(offer.price_total, offer.currency)}</span>
                    )}
                    {offer.price_total !== null && <span className="text-ink-soft"> total</span>}
                    {offer.price_per_night !== null && (
                      <span className="text-ink-soft"> · {formatMoney(offer.price_per_night, offer.currency)} a night</span>
                    )}
                  </p>
                  {offer.rating !== null && (
                    <p className="flex items-center gap-1">
                      <Star className="size-3.5 fill-current text-amber-500" aria-hidden="true" />
                      <span className="type-data">{Number(offer.rating).toFixed(1)}</span>
                      {offer.review_count !== null && <span className="text-ink-soft">({offer.review_count})</span>}
                    </p>
                  )}
                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <Button size="sm" variant={isSaved ? 'ghost' : 'outline'} disabled={isSaved || add.isPending} onClick={() => keep(offer)}>
                      {isSaved ? (
                        <>
                          <Check aria-hidden="true" />
                          On the list
                        </>
                      ) : (
                        'Add to list'
                      )}
                    </Button>
                    {offer.link && (
                      <a
                        href={offer.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-brand underline-offset-2 hover:underline"
                      >
                        View
                      </a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
