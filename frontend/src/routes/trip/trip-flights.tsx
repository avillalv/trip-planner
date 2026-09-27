import { Plane, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { BestOptions } from '@/components/flights/best-options'
import { ChooseFlightDialog, type FlightPick } from '@/components/flights/choose-flight-dialog'
import { CheckStatus } from '@/components/flights/check-status'
import { DateGrid } from '@/components/flights/date-grid'
import { PriceHistoryChart } from '@/components/flights/price-history-chart'
import { RouteCard } from '@/components/flights/route-card'
import { RouteEditor } from '@/components/flights/route-editor'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  flightKey,
  isActive,
  useBestOptions,
  useClearFlight,
  useDateGrid,
  useDeleteRoute,
  useHideQuote,
  useLatestRun,
  useRefreshFlights,
  useRouteHistory,
  useRouteSummaries,
  useRoutes,
  useSaveRoute,
  type DateGridCell,
  type FlightRoute,
  type Quote,
  type RouteSummary,
} from '@/lib/api/flights'
import { formatDateRange } from '@/lib/dates'
import { useTripContext } from './trip-context'

function routeName(route: FlightRoute): string {
  return route.label || `${route.origin_codes.join(', ')} → ${route.destination_codes.join(', ')}`
}

function pickFromQuote(q: Quote): FlightPick {
  return {
    routeId: q.route_id,
    quoteId: q.id,
    route: `${q.origin} → ${q.destination}`,
    depart_date: q.depart_date,
    return_date: q.return_date,
    airlines: q.airlines,
    price: Number(q.price_home ?? q.price_total),
    currency: q.price_home ? q.home_currency : q.currency,
  }
}

function Trends({
  tripId,
  routes,
  summaries,
  currency,
  onChoose,
}: {
  tripId: number
  routes: FlightRoute[]
  summaries: RouteSummary[]
  currency: string
  onChoose: (route: FlightRoute, cell: DateGridCell) => void
}) {
  const [selected, setSelected] = useState<number | undefined>(routes[0]?.id)
  const routeId = routes.some((r) => r.id === selected) ? selected : routes[0]?.id
  const route = routes.find((r) => r.id === routeId)
  const chosen = summaries.find((s) => s.route_id === routeId)?.chosen ?? null
  const history = useRouteHistory(tripId, routeId)
  const grid = useDateGrid(tripId, routeId)
  if (!route) return null

  return (
    <section aria-labelledby="trends-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="trends-heading" className="type-heading">
          Price trend
        </h3>
        {routes.length > 1 && (
          <select
            aria-label="Route"
            value={routeId}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="h-8 rounded-lg border border-input bg-card px-2 text-sm"
          >
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {routeName(r)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h4 className="mb-3 text-sm font-semibold">Cheapest price each day</h4>
          {history.data ? (
            <PriceHistoryChart history={history.data} dimmed={history.isPlaceholderData} />
          ) : (
            <Skeleton className="h-64" />
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h4 className="mb-3 text-sm font-semibold">Best price by date (last 7 days)</h4>
          {grid.data ? (
            <DateGrid
              route={route}
              cells={grid.data}
              currency={currency}
              chosen={chosen}
              onChoose={(cell) => onChoose(route, cell)}
            />
          ) : (
            <Skeleton className="h-64" />
          )}
        </div>
      </div>
    </section>
  )
}

export function TripFlights() {
  const { trip } = useTripContext()
  const routes = useRoutes(trip.id)
  const summaries = useRouteSummaries(trip.id)
  const [filter, setFilter] = useState<number | undefined>()
  const best = useBestOptions(trip.id, filter)
  const latest = useLatestRun(trip.id)
  const refresh = useRefreshFlights(trip.id)
  const hide = useHideQuote(trip.id)
  const remove = useDeleteRoute(trip.id)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<FlightRoute | undefined>()
  const [deleting, setDeleting] = useState<FlightRoute | null>(null)
  const [toggling, setToggling] = useState<FlightRoute | undefined>()
  const toggle = useSaveRoute(trip.id, toggling?.id)
  const [pick, setPick] = useState<FlightPick | null>(null)
  const clear = useClearFlight()
  const chosenKeys = new Set(
    (summaries.data ?? []).flatMap((s) => [s.chosen, s.chosen_latest]).filter((q): q is Quote => Boolean(q)).map(flightKey),
  )
  const clearChoice = (route: FlightRoute) =>
    clear.mutate(route.id, {
      onSuccess: () => toast.success('Flight cleared. The trip keeps its dates, and you can change them again.'),
      onError: (e) => toast.error(e.message),
    })

  const openEditor = (route?: FlightRoute) => {
    setEditing(route)
    setEditorOpen(true)
  }
  const checkNow = (routeIds: number[] = []) =>
    refresh.mutate(routeIds, {
      onSuccess: () => toast.success('Checking prices now'),
      onError: (e) => toast.error(e.message),
    })
  const toggleActive = (route: FlightRoute) => {
    setToggling(route)
    const { id: _id, trip_id: _trip, created_at: _c, updated_at: _u, ...input } = route
    toggle.mutate(
      { ...input, active: !route.active },
      { onSuccess: () => toast.success(route.active ? 'Checks paused' : 'Checks resumed') },
    )
  }

  const all = routes.data ?? []
  const checking = isActive(latest.data ?? undefined)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-title text-2xl">Flights</h2>
          <p className="mt-1 text-sm text-ink-soft">Every price check is kept, so you can watch fares move.</p>
        </div>
        {all.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => checkNow()} disabled={checking || refresh.isPending}>
              <RefreshCw aria-hidden="true" className={checking ? 'animate-spin' : undefined} />
              Check prices now
            </Button>
            <Button onClick={() => openEditor()}>
              <Plus aria-hidden="true" />
              Add route
            </Button>
          </div>
        )}
      </div>

      {routes.isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : all.length === 0 ? (
        <section className="flex flex-col items-center rounded-xl border bg-card px-6 py-12 text-center">
          <Plane className="size-10 text-brand" aria-hidden="true" />
          <h3 className="type-heading mt-4 text-xl">Track flight prices</h3>
          <p className="mt-2 max-w-md text-ink-soft">
            Add the airports you'd fly between and a range of dates. Prices are checked twice a day on Google Flights
            and Aviasales, cheapest first, with the history kept.
          </p>
          <Button className="mt-6" onClick={() => openEditor()}>
            <Plus aria-hidden="true" />
            Add a route
          </Button>
        </section>
      ) : (
        <>
          <CheckStatus tripId={trip.id} />

          <section aria-label="Tracked routes" className="grid gap-4 lg:grid-cols-2">
            {all.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                summary={summaries.data?.find((s) => s.route_id === route.id)}
                currency={trip.home_currency}
                onEdit={() => openEditor(route)}
                onCheck={() => checkNow([route.id])}
                onToggleActive={() => toggleActive(route)}
                onDelete={() => setDeleting(route)}
                onClearChoice={() => clearChoice(route)}
              />
            ))}
          </section>

          <section aria-labelledby="best-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="best-heading" className="type-heading">
                  Cheapest options
                </h3>
                <p className="text-sm text-ink-soft">
                  {trip.flight_dates && trip.start_date && trip.end_date
                    ? `Your flight sets the trip's dates: ${formatDateRange(trip.start_date, trip.end_date)}. Choose another to change them.`
                    : "Choose a flight, and the trip's dates become its dates."}
                </p>
              </div>
              {all.length > 1 && (
                <select
                  aria-label="Show prices for"
                  value={filter ?? ''}
                  onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : undefined)}
                  className="h-8 rounded-lg border border-input bg-card px-2 text-sm"
                >
                  <option value="">All routes</option>
                  {all.map((r) => (
                    <option key={r.id} value={r.id}>
                      {routeName(r)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {best.data ? (
              <BestOptions
                quotes={best.data}
                currency={trip.home_currency}
                chosen={chosenKeys}
                onChoose={(quote) => setPick(pickFromQuote(quote))}
                dimmed={best.isPlaceholderData}
                onHide={(quote) =>
                  hide.mutate({ quoteId: quote.id, hidden: true }, { onSuccess: () => toast.success('Price hidden') })
                }
              />
            ) : (
              <Skeleton className="h-48 rounded-xl" />
            )}
          </section>

          <Trends
            tripId={trip.id}
            routes={all}
            summaries={summaries.data ?? []}
            currency={trip.home_currency}
            onChoose={(route, cell) =>
              setPick({
                routeId: route.id,
                quoteId: cell.quote_id,
                route: routeName(route),
                depart_date: cell.depart_date,
                return_date: cell.return_date,
                airlines: [],
                price: Number(cell.price),
                currency: trip.home_currency,
              })
            }
          />
        </>
      )}

      <RouteEditor open={editorOpen} onOpenChange={setEditorOpen} trip={trip} route={editing} />
      <ChooseFlightDialog trip={trip} pick={pick} onClose={() => setPick(null)} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting ? routeName(deleting) : 'route'}?</AlertDialogTitle>
            <AlertDialogDescription>Its price history is deleted too. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep route</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success('Route deleted'),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Delete route
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
