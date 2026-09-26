import { Check, ChevronsUpDown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Trip } from '@/lib/api/trips'

type Props = { trips: Trip[]; currentId?: number; onNavigate?: () => void }

/** Pick which trip the section links point at, staying in the same section when switching. */
export function TripSwitcher({ trips, currentId, onNavigate }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const current = trips.find((t) => t.id === currentId)
  const section = pathname.match(/^\/trips\/\d+\/([^/]+)/)?.[1]
  const choices = trips.filter((t) => t.status !== 'archived' || t.id === currentId)

  const go = (path: string) => {
    navigate(path)
    onNavigate?.()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-left text-sm text-white outline-offset-2 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring"
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{current?.name ?? 'Choose a trip'}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-cover-soft" aria-hidden="true" />
          <span className="sr-only">Switch trip</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch trip</DropdownMenuLabel>
        {choices.map((trip) => (
          <DropdownMenuItem key={trip.id} onSelect={() => go(`/trips/${trip.id}${section ? `/${section}` : ''}`)}>
            <span className="min-w-0 flex-1 truncate">{trip.name}</span>
            {trip.id === currentId && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go('/')}>All trips</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
