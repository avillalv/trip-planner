import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import { appSections, tripSections, tripsEntry, type NavEntry } from './nav-config'

const itemClass =
  'relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.9rem] text-cover-soft transition-colors outline-offset-2 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring'
// The active page gets a rose tab on the rail's edge, like a marked passport page.
const activeClass =
  'bg-sidebar-accent text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r-sm before:bg-sidebar-primary'

function NavItem({ entry, to, end, onNavigate }: { entry: NavEntry; to: string; end?: boolean; onNavigate?: () => void }) {
  const Icon = entry.icon
  return (
    <li>
      <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => cn(itemClass, isActive && activeClass)}>
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {entry.label}
      </NavLink>
    </li>
  )
}

export function SidebarNav({ tripId, onNavigate }: { tripId?: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-0.5">
        <NavItem entry={tripsEntry} to="/" end onNavigate={onNavigate} />
      </ul>

      <nav aria-labelledby="nav-trip-label">
        <p id="nav-trip-label" className="type-label mb-2 px-3 text-cover-soft/80">
          This trip
        </p>
        {tripId ? (
          <ul className="flex flex-col gap-0.5">
            {tripSections.map((entry) => (
              <NavItem
                key={entry.label}
                entry={entry}
                to={`/trips/${tripId}${entry.to ? `/${entry.to}` : ''}`}
                end={entry.to === ''}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 text-sm leading-snug text-cover-soft/80">
            Open a trip to see its flights, days, and places to stay.
          </p>
        )}
      </nav>

      <nav aria-label="Automation and settings" className="border-t border-sidebar-border pt-4">
        <ul className="flex flex-col gap-0.5">
          {appSections.map((entry) => (
            <NavItem key={entry.label} entry={entry} to={entry.to} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>
    </div>
  )
}
