import { ChevronLeft, ChevronRight, LayoutGrid, Maximize, Minimize, Printer, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useFullscreen, useIdle, usePrintInLight } from '@/components/deck/deck-hooks'
import { buildSlides } from '@/components/deck/deck-model'
import { DeckOverview } from '@/components/deck/deck-overview'
import { SlideContext } from '@/components/deck/slide-context'
import { SlideView } from '@/components/deck/slides'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { usePresentation } from '@/lib/api/presentation'
import { cn } from '@/lib/utils'

const LIVE = { live: true }
const STILL = { live: false }
const PILL = 'rounded-full bg-black/55 text-white backdrop-blur-sm'
const SWIPE_PX = 50

/** "#4" in the address opens slide 4, so a reload (or a shared link) keeps your place. */
function slideFromHash(): number {
  const n = Number(window.location.hash.slice(1))
  return Number.isInteger(n) && n > 0 ? n - 1 : 0
}

function ChromeButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center rounded-full outline-offset-2 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35 disabled:hover:bg-transparent [&_svg]:size-4.5"
    >
      {children}
    </button>
  )
}

export function PresentPage() {
  const tripId = Number(useParams().tripId)
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const deck = usePresentation(tripId)
  const slides = useMemo(() => (deck.data ? buildSlides(deck.data) : []), [deck.data])
  const total = slides.length
  const [requested, setRequested] = useState(slideFromHash)
  const index = total ? Math.min(Math.max(requested, 0), total - 1) : 0
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [overview, setOverview] = useState(false)
  const fullscreen = useFullscreen()
  const idle = useIdle(2500)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  usePrintInLight()

  const go = useCallback(
    (to: number) => {
      const next = Math.min(Math.max(to, 0), Math.max(total - 1, 0))
      setDirection(next >= index ? 'forward' : 'back')
      setRequested(next)
    },
    [index, total],
  )
  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    navigate(from ?? `/trips/${tripId}`)
  }, [from, navigate, tripId])

  useEffect(() => {
    if (total) window.history.replaceState(window.history.state, '', `#${index + 1}`)
  }, [index, total])

  // Typing a slide number into the address goes there too.
  useEffect(() => {
    const onHash = () => setRequested(slideFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!deck.data) return
    const before = document.title
    // Also the suggested file name when saving as PDF.
    document.title = `${deck.data.trip.name} – trip plan`
    return () => {
      document.title = before
    }
  }, [deck.data])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      // A focused button handles its own Space and Enter.
      if ((event.key === ' ' || event.key === 'Enter') && target.closest('button, a')) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (overview) {
        if (key === 'Escape' || key === 'g') {
          event.preventDefault()
          setOverview(false)
        }
        return
      }
      if (key === 'ArrowRight' || key === 'PageDown' || (key === ' ' && !event.shiftKey)) go(index + 1)
      else if (key === 'ArrowLeft' || key === 'PageUp' || (key === ' ' && event.shiftKey)) go(index - 1)
      else if (key === 'Home') go(0)
      else if (key === 'End') go(total - 1)
      else if (key === 'f') fullscreen.toggle()
      else if (key === 'g') setOverview(true)
      else if (key === 'Escape') exit()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit, fullscreen, go, index, overview, total])

  if (deck.isPending) return <div className="fixed inset-0 bg-[var(--tp-cover)]" aria-busy="true" />
  if (deck.isError) {
    const missing = deck.error instanceof ApiError && deck.error.status === 404
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="type-title">{missing ? 'This trip isn’t available' : 'The presentation didn’t load'}</h1>
        <p className="mt-3 text-ink-soft">
          {missing
            ? 'It may have been deleted. Pick a trip from your list to present it.'
            : `${deck.error.message} Check that Trip Planner is still running, then try again.`}
        </p>
        <div className="mt-6 flex gap-2">
          {missing ? (
            <Button asChild>
              <Link to="/">Go to trips</Link>
            </Button>
          ) : (
            <>
              <Button onClick={() => deck.refetch()}>Try again</Button>
              <Button variant="outline" asChild>
                <Link to={from ?? `/trips/${tripId}`}>Back to the trip</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  const data = deck.data
  const current = slides[index]
  return (
    <div className={cn('deck-root fixed inset-0 overflow-hidden bg-background', idle && !overview && 'cursor-none')}>
      <main
        className="deck-stage absolute inset-0"
        style={{ touchAction: 'pan-y' }}
        aria-roledescription="carousel"
        aria-label={`${data.trip.name}: presentation`}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const start = swipe.current
          swipe.current = null
          if (!start || start.id !== e.pointerId) return
          const dx = e.clientX - start.x
          const dy = e.clientY - start.y
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? index + 1 : index - 1)
        }}
        onPointerCancel={() => {
          swipe.current = null
        }}
      >
        {slides.map((slide, i) => (
          <section
            key={slide.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}: ${slide.label}`}
            aria-hidden={i !== index}
            className={cn(
              'deck-slide absolute inset-0',
              i !== index && 'hidden',
              i === index && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300',
              i === index && (direction === 'forward' ? 'motion-safe:slide-in-from-right-8' : 'motion-safe:slide-in-from-left-8'),
            )}
          >
            <SlideContext.Provider value={i === index ? LIVE : STILL}>
              <SlideView deck={data} slide={slide} index={i} total={total} />
            </SlideContext.Provider>
          </section>
        ))}
      </main>

      <p className="sr-only" aria-live="polite">
        Slide {index + 1} of {total}: {current.label}
      </p>

      {/* Controls along the bottom, clear of each page's header and stamp; they fade while you present. */}
      <div
        className={cn(
          'deck-chrome pointer-events-none fixed inset-x-3 bottom-3 z-20 flex items-end justify-between gap-3 transition-opacity duration-300',
          idle && !overview && 'opacity-0',
        )}
      >
        <div className={cn(PILL, 'pointer-events-auto flex items-center gap-0.5 p-0.5')}>
          <button
            type="button"
            onClick={exit}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold outline-offset-2 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="size-4" aria-hidden="true" />
            Exit
          </button>
          <span className="mx-0.5 h-5 w-px bg-white/25" aria-hidden="true" />
          <ChromeButton label="Previous slide" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronLeft aria-hidden="true" />
          </ChromeButton>
          <span className="type-data min-w-14 text-center text-sm">
            {index + 1} / {total}
          </span>
          <ChromeButton label="Next slide" onClick={() => go(index + 1)} disabled={index === total - 1}>
            <ChevronRight aria-hidden="true" />
          </ChromeButton>
          <span className="mx-0.5 h-5 w-px bg-white/25" aria-hidden="true" />
          <ChromeButton label="All slides (G)" onClick={() => setOverview(true)}>
            <LayoutGrid aria-hidden="true" />
          </ChromeButton>
          {fullscreen.supported && (
            <ChromeButton label={fullscreen.on ? 'Leave full screen (F)' : 'Full screen (F)'} onClick={fullscreen.toggle}>
              {fullscreen.on ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
            </ChromeButton>
          )}
          <ChromeButton label="Print or save as PDF" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
          </ChromeButton>
        </div>
        <p className={cn(PILL, 'hidden px-3 py-1.5 text-xs lg:block')}>
          ← → to move · F full screen · G all slides · Esc to leave
        </p>
      </div>

      <div className="deck-chrome pointer-events-none fixed inset-x-0 bottom-0 z-20 h-1 bg-black/15" aria-hidden="true">
        <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      {overview && (
        <DeckOverview
          deck={data}
          slides={slides}
          current={index}
          onPick={(i) => {
            setOverview(false)
            go(i)
          }}
          onClose={() => setOverview(false)}
        />
      )}
    </div>
  )
}
