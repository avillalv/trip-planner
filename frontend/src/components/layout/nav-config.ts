import { BedDouble, Bot, CalendarDays, LayoutDashboard, Luggage, Plane, Settings, type LucideIcon } from 'lucide-react'

export type NavEntry = { to: string; label: string; icon: LucideIcon }

export const tripsEntry: NavEntry = { to: '/', label: 'Trips', icon: Luggage }

/** Sections scoped to one trip; `to` is relative to /trips/:tripId. */
export const tripSections: NavEntry[] = [
  { to: '', label: 'Overview', icon: LayoutDashboard },
  { to: 'flights', label: 'Flights', icon: Plane },
  { to: 'itinerary', label: 'Itinerary', icon: CalendarDays },
  { to: 'lodging', label: 'Lodging', icon: BedDouble },
]

export const appSections: NavEntry[] = [
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/settings', label: 'Settings', icon: Settings },
]
