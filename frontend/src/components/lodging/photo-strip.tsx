import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** Swipeable photos (scroll-snap), with arrows for mouse users. Photos that fail to load drop out. */
export function PhotoStrip({ photos, title, className }: { photos: string[]; title: string; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const [index, setIndex] = useState(0)
  const shown = photos.filter((p) => !broken.has(p))

  const go = (step: number) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: step * el.clientWidth, behavior: 'smooth' })
  }

  if (shown.length === 0) {
    return (
      <div className={cn('flex aspect-[3/2] items-center justify-center bg-muted text-ink-soft', className)}>
        <ImageOff className="size-6" aria-hidden="true" />
        <span className="sr-only">No photos</span>
      </div>
    )
  }

  return (
    <div className={cn('group relative aspect-[3/2] overflow-hidden bg-muted', className)}>
      <div
        ref={scroller}
        className="flex h-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
        }}
      >
        {shown.map((photo, i) => (
          <img
            key={photo}
            src={photo}
            alt={i === 0 ? title : ''}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full shrink-0 snap-center object-cover"
            onError={() => setBroken((b) => new Set(b).add(photo))}
          />
        ))}
      </div>
      {shown.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(-1)}
            className="absolute top-1/2 left-2 hidden -translate-y-1/2 rounded-full bg-black/45 p-1 text-white group-hover:block focus-visible:block"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(1)}
            className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-full bg-black/45 p-1 text-white group-hover:block focus-visible:block"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <span className="type-data absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-[0.6875rem] text-white">
            {Math.min(index + 1, shown.length)} / {shown.length}
          </span>
        </>
      )}
    </div>
  )
}
