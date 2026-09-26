import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Presentation } from '@/lib/api/presentation'
import { cn } from '@/lib/utils'
import type { Slide } from './deck-model'
import { SlideContext } from './slide-context'
import { SlideView } from './slides'

// Thumbnails are real slides drawn at this size and scaled down, so they match the deck exactly.
const THUMB = { width: 1600, height: 900 }
const STILL = { live: false }

type Props = {
  deck: Presentation
  slides: Slide[]
  current: number
  onPick: (index: number) => void
  onClose: () => void
}

export function DeckOverview({ deck, slides, current, onPick, onClose }: Props) {
  const listRef = useRef<HTMLOListElement>(null)
  const [scale, setScale] = useState(0.2)

  useLayoutEffect(() => {
    const box = listRef.current?.querySelector<HTMLElement>('[data-thumb]')
    if (!box) return
    const measure = () => setScale(box.clientWidth / THUMB.width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const here = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    here?.scrollIntoView({ block: 'center' })
    here?.focus()
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All slides"
      className="deck-overview fixed inset-0 z-30 overflow-y-auto bg-background/95 px-4 py-6 backdrop-blur md:px-10"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="type-heading">All slides</h2>
          <Button variant="outline" onClick={onClose}>
            <X aria-hidden="true" />
            Close
          </Button>
        </div>
        <ol ref={listRef} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {slides.map((slide, i) => (
            <li key={slide.key}>
              <button
                type="button"
                aria-current={i === current}
                onClick={() => onPick(i)}
                className="group block w-full rounded-lg text-left outline-none"
              >
                <div
                  data-thumb
                  className={cn(
                    'relative aspect-video overflow-hidden rounded-lg border shadow-sm transition-shadow group-hover:ring-2 group-hover:ring-ring/40 group-focus-visible:ring-3 group-focus-visible:ring-ring',
                    i === current && 'ring-3 ring-brand',
                  )}
                >
                  <div
                    inert
                    className="deck-thumb absolute top-0 left-0 origin-top-left"
                    style={{ width: THUMB.width, height: THUMB.height, transform: `scale(${scale})` }}
                  >
                    <SlideContext.Provider value={STILL}>
                      <SlideView deck={deck} slide={slide} index={i} total={slides.length} />
                    </SlideContext.Provider>
                  </div>
                </div>
                <p className="mt-2 flex gap-2 text-sm">
                  <span className="type-data text-ink-soft">{i + 1}</span>
                  <span className="truncate">{slide.label}</span>
                </p>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
