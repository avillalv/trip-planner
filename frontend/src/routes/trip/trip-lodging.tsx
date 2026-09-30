import { BedDouble, Loader2, Plus, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AiLodgingDialog } from '@/components/lodging/ai-lodging-dialog'
import { BookmarkletCard } from '@/components/lodging/bookmarklet-card'
import { CompareDialog } from '@/components/lodging/compare-dialog'
import { LodgingCard } from '@/components/lodging/lodging-card'
import { LodgingEditor } from '@/components/lodging/lodging-editor'
import { byAiRank } from '@/components/lodging/lodging-meta'
import { RentalSearchDialog } from '@/components/lodging/rental-search'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isRunning } from '@/lib/api/agents'
import { useActivities } from '@/lib/api/itinerary'
import { useLodging, type Lodging } from '@/lib/api/lodging'
import { useLatestAiRun } from '@/lib/api/suggestions'
import { cn } from '@/lib/utils'
import { useTripContext } from './trip-context'

type View = 'all' | 'shortlist' | 'ai' | 'rejected'
type Sort = 'added' | 'rank' | 'price' | 'rating'

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'shortlist', label: 'Shortlist' },
  { value: 'ai', label: 'AI picks' },
  { value: 'rejected', label: 'Not for us' },
]

const MAX_COMPARE = 4

function visible(option: Lodging, view: View): boolean {
  if (view === 'rejected') return option.status === 'rejected'
  if (view === 'ai') return option.added_via === 'agent' && option.status !== 'rejected'
  if (view === 'shortlist') return option.favorite || option.status === 'shortlisted' || option.status === 'booked'
  return option.status !== 'rejected'
}

function order(sort: Sort) {
  const price = (o: Lodging) => (o.price_home_total !== null ? Number(o.price_home_total) : Infinity)
  const rating = (o: Lodging) => (o.rating !== null ? Number(o.rating) : -1)
  return (a: Lodging, b: Lodging) => {
    if (sort === 'rank') return byAiRank(a, b)
    if (sort === 'price') return price(a) - price(b)
    if (sort === 'rating') return rating(b) - rating(a)
    return b.created_at.localeCompare(a.created_at)
  }
}

export function TripLodging() {
  const { trip } = useTripContext()
  const aiRun = useLatestAiRun(trip.id, 'lodging_agent').run
  const picking = aiRun !== undefined && isRunning(aiRun.status)
  const lodging = useLodging(trip.id, picking)
  const activities = useActivities(trip.id)
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<Sort>('added')
  const [editing, setEditing] = useState<Lodging | null>(null)
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [asking, setAsking] = useState(false)
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [comparing, setComparing] = useState(false)

  const all = useMemo(() => lodging.data ?? [], [lodging.data])
  const shown = useMemo(() => all.filter((o) => visible(o, view)).sort(order(sort)), [all, view, sort])
  const selected = compareIds.map((id) => all.find((o) => o.id === id)).filter((o): o is Lodging => Boolean(o))
  const savedUrls = useMemo(() => new Set(all.map((o) => o.url).filter((u): u is string => Boolean(u))), [all])
  // The AI picks view starts in the AI's own ranking; the others start newest first.
  const showView = (next: View) => {
    setView(next)
    setSort((s) => (next === 'ai' ? (s === 'added' ? 'rank' : s) : s === 'rank' ? 'added' : s))
  }
  const toggleCompare = (option: Lodging) =>
    setCompareIds((ids) => (ids.includes(option.id) ? ids.filter((id) => id !== option.id) : [...ids, option.id]))

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-24 md:px-10 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-heading">Places to stay</h2>
          <p className="text-sm text-ink-soft">Save options from anywhere, then shortlist and compare them together.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSearching(true)}>
            <Search aria-hidden="true" />
            Search rentals
          </Button>
          <Button variant="outline" onClick={() => setAsking(true)}>
            {picking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            AI picks
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add a place
          </Button>
        </div>
      </div>

      <BookmarkletCard />

      {all.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Show" className="flex rounded-lg border p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => showView(v.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm',
                  view === v.value ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-soft hover:bg-accent',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-soft">Sort by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-8 rounded-lg border border-input bg-card px-2 text-sm"
            >
              {view === 'ai' && <option value="rank">AI ranking</option>}
              <option value="added">Newest</option>
              <option value="price">Price, lowest first</option>
              <option value="rating">Rating, highest first</option>
            </select>
          </label>
        </div>
      )}

      {lodging.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <BedDouble className="mx-auto size-7 text-ink-soft" aria-hidden="true" />
          <p className="mt-2 font-semibold">No places to stay yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
            Paste a listing’s link, search rentals for your dates, or use the bookmarklet while you browse.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">Nothing here yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((option) => (
            <LodgingCard
              key={option.id}
              option={option}
              travelers={trip.travelers}
              onEdit={setEditing}
              comparing={compareIds.includes(option.id)}
              compareFull={compareIds.length >= MAX_COMPARE}
              onToggleCompare={toggleCompare}
            />
          ))}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-4 py-3 shadow-lg backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {selected.length === 1 ? 'Pick at least one more to compare.' : `${selected.length} places selected`}
              <span className="text-ink-soft"> · up to {MAX_COMPARE}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setCompareIds([])}>
                Clear
              </Button>
              <Button disabled={selected.length < 2} onClick={() => setComparing(true)}>
                Compare {selected.length}
              </Button>
            </div>
          </div>
        </div>
      )}

      <LodgingEditor
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false)
            setEditing(null)
          }
        }}
        tripId={trip.id}
        option={editing}
        initial={{
          checkIn: trip.start_date ?? '',
          checkOut: trip.end_date ?? '',
          guests: trip.travelers.length ? String(trip.travelers.length) : '',
          currency: trip.home_currency,
        }}
      />
      <AiLodgingDialog open={asking} onOpenChange={setAsking} trip={trip} onShowPicks={() => showView('ai')} />
      <RentalSearchDialog open={searching} onOpenChange={setSearching} trip={trip} savedUrls={savedUrls} />
      <CompareDialog
        open={comparing}
        onOpenChange={setComparing}
        options={selected}
        activities={activities.data ?? []}
        travelers={trip.travelers.length}
      />
    </div>
  )
}
