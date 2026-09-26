import { Bookmark } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { bookmarkletCode } from './lodging-meta'

/** Install instructions for the "Save to Trip Planner" bookmarklet (computers only). */
export function BookmarkletCard() {
  const link = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    // React blocks javascript: URLs in href props, so the bookmark's code is set on the element itself.
    link.current?.setAttribute('href', bookmarkletCode(window.location.origin))
  }, [])

  return (
    // Hidden on phones, which have no bookmarks bar to drag it to.
    <details className="group hidden rounded-xl border bg-card p-4 text-sm sm:block [&[open]>summary]:mb-3">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <Bookmark className="size-4 text-brand" aria-hidden="true" />
        Save listings from any site with one click
      </summary>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          On a computer, drag this button to your bookmarks bar:{' '}
          <a
            ref={link}
            draggable
            onClick={(event) => {
              event.preventDefault()
              toast.info('Drag the button to your bookmarks bar, then click it on a listing.')
            }}
            className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-brand bg-brand-soft px-3 py-1 font-semibold text-brand"
          >
            <Bookmark className="size-3.5" aria-hidden="true" />
            Save to Trip Planner
          </a>
        </li>
        <li>
          On a listing you’re viewing (Airbnb, Vrbo, Booking.com, or any other site), click the bookmark. Trip Planner
          opens with the name, photos, price, and rating the page shows, ready for you to check and save.
        </li>
      </ol>
      <p className="mt-3 text-xs text-ink-soft">
        It reads only the page you have open, in your own browser; the app never visits the site itself. Prices
        shown on some sites depend on the dates you picked there.
      </p>
    </details>
  )
}
