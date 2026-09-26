import { ArrowLeft, Clock, ExternalLink, Globe, MapPin, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CATEGORY, googleMapsUrl } from '@/lib/activity-meta'
import { usePlaceDetails, usePlaceWiki, type Place } from '@/lib/api/itinerary'
import { formatDistance, formatOpeningHours } from './labels'

export function OpeningHours({ value }: { value: string }) {
  const lines = formatOpeningHours(value)
  return (
    <div className="flex items-start gap-2">
      <Clock className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
      <div>
        <p className="sr-only">Opening hours</p>
        {lines.map((line) => (
          <p key={line} className="type-data text-sm">
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

function ExternalRow({ icon: Icon, href, children }: { icon: typeof Globe; href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 font-semibold text-brand underline-offset-2 hover:underline"
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </a>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

type Props = { place: Place; onBack: () => void; children: ReactNode }

/** Everything known about a place, with the add-to-trip controls passed in as children. */
export function PlaceDetailsPane({ place: found, onBack, children }: Props) {
  const details = usePlaceDetails(found)
  const place = { ...found, ...(details.data ?? {}), distance_m: found.distance_m }
  const wiki = usePlaceWiki(place)
  const { label, icon: Icon, color } = CATEGORY[place.category]
  const distance = formatDistance(place.distance_m)

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-ink-soft">
        <ArrowLeft aria-hidden="true" />
        Back to results
      </Button>

      <div>
        <h3 className="type-heading text-lg leading-snug">{place.name}</h3>
        {place.local_name && <p className="text-sm text-ink-soft" lang="und">{place.local_name}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
          <Icon className="size-3.5" style={{ color }} aria-hidden="true" />
          {label}
          {distance && <span>· {distance} away</span>}
        </p>
      </div>

      {wiki.data && (
        <figure className="overflow-hidden rounded-xl border bg-card">
          {wiki.data.image_url && (
            <img src={wiki.data.image_url} alt="" className="max-h-44 w-full object-cover" loading="lazy" />
          )}
          <figcaption className="space-y-1.5 p-3 text-sm">
            <p className="line-clamp-5 leading-relaxed">{wiki.data.extract}</p>
            {wiki.data.url && (
              <a
                href={wiki.data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-brand underline-offset-2 hover:underline"
              >
                Read more on Wikipedia
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </figcaption>
        </figure>
      )}

      <div className="space-y-2.5 text-sm">
        {place.address && (
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
            {place.address}
          </p>
        )}
        {details.isFetching && !place.has_details ? (
          <div className="space-y-2" aria-label="Loading details">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          place.opening_hours && <OpeningHours value={place.opening_hours} />
        )}
        {place.phone && <ExternalRow icon={Phone} href={`tel:${place.phone.replace(/\s/g, '')}`}>{place.phone}</ExternalRow>}
        {place.website && <ExternalRow icon={Globe} href={place.website}>{hostOf(place.website)}</ExternalRow>}
        <ExternalRow icon={ExternalLink} href={googleMapsUrl(place)}>
          Open in Google Maps (reviews and photos)
        </ExternalRow>
      </div>

      <div className="border-t pt-4">{children}</div>
    </div>
  )
}
