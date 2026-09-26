import {
  Binoculars,
  Coffee,
  Landmark,
  Martini,
  Palette,
  ShoppingBag,
  Sparkles,
  TrainFront,
  Trees,
  Utensils,
  TreePalm,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityCategory, ActivityStatus, SearchKind } from './api/itinerary'

/**
 * Colors follow the group (validated for color-blind separation); the icon and label tell the
 * categories within a group apart, so color is never the only cue.
 */
export const CATEGORY: Record<ActivityCategory, { label: string; icon: LucideIcon; color: string }> = {
  sights: { label: 'Sights', icon: Landmark, color: 'var(--cat-culture)' },
  museum: { label: 'Museums and culture', icon: Palette, color: 'var(--cat-culture)' },
  food: { label: 'Food and drink', icon: Utensils, color: 'var(--cat-food)' },
  nightlife: { label: 'Nightlife', icon: Martini, color: 'var(--cat-food)' },
  nature: { label: 'Outdoors', icon: Trees, color: 'var(--cat-outdoors)' },
  shopping: { label: 'Shopping', icon: ShoppingBag, color: 'var(--cat-shopping)' },
  travel: { label: 'Getting around', icon: TrainFront, color: 'var(--cat-neutral)' },
  other: { label: 'Other', icon: Sparkles, color: 'var(--cat-neutral)' },
}

export const CATEGORY_ORDER = Object.keys(CATEGORY) as ActivityCategory[]

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  booked: 'Booked',
}

export const SEARCH_KINDS: Array<{ kind: SearchKind; label: string; icon: LucideIcon }> = [
  { kind: 'restaurants', label: 'Restaurants', icon: Utensils },
  { kind: 'cafes', label: 'Cafés', icon: Coffee },
  { kind: 'museums', label: 'Museums', icon: Palette },
  { kind: 'landmarks', label: 'Landmarks', icon: Landmark },
  { kind: 'viewpoints', label: 'Viewpoints', icon: Binoculars },
  { kind: 'parks', label: 'Parks', icon: Trees },
  { kind: 'beaches', label: 'Beaches', icon: TreePalm },
  { kind: 'nightlife', label: 'Nightlife', icon: Martini },
  { kind: 'shopping', label: 'Shopping', icon: ShoppingBag },
]

/** A tinted fill for calendar blocks and cards: the group color, mostly the card surface. */
export function tint(color: string, percent = 16): string {
  return `color-mix(in oklab, ${color} ${percent}%, var(--card))`
}

/** A link that opens the place in Google Maps (reviews, photos, directions); no API key needed. */
export function googleMapsUrl(place: { name: string; address?: string | null; lat?: number | null; lon?: number | null }) {
  const query = [place.name, place.address].filter(Boolean).join(', ')
  const params = new URLSearchParams({ api: '1', query: query || `${place.lat},${place.lon}` })
  return `https://www.google.com/maps/search/?${params}`
}
