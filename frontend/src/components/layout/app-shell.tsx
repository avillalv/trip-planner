import { Menu } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useMatch } from 'react-router'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { SidebarNav } from './sidebar-nav'
import { SystemStatusIndicator } from './system-status-indicator'
import { ThemeToggle } from './theme-toggle'

function RailFooter() {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-sidebar-border px-5 py-4">
      <SystemStatusIndicator />
      <ThemeToggle />
    </div>
  )
}

export function AppShell() {
  const tripParam = useMatch('/trips/:tripId/*')?.params.tripId
  const tripId = tripParam ? Number(tripParam) : undefined
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Desktop: the passport-cover navigation rail */}
      <aside className="on-cover sticky top-0 hidden h-dvh flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pt-6 pb-7">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav tripId={tripId} />
        </div>
        <RailFooter />
      </aside>

      {/* Phones: compact header with a slide-out menu */}
      <header className="on-cover sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
        <Logo />
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon-lg" className="text-white hover:bg-sidebar-accent hover:text-white">
              <Menu aria-hidden="true" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="on-cover w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Navigate between trips and sections</SheetDescription>
            <div className="px-5 pt-6 pb-5">
              <Logo onNavigate={closeMenu} />
            </div>
            <div className="flex-1 overflow-y-auto px-3">
              <SidebarNav tripId={tripId} onNavigate={closeMenu} />
            </div>
            <RailFooter />
          </SheetContent>
        </Sheet>
      </header>

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
