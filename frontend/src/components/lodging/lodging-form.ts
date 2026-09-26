import type { Lodging, LodgingInput, LodgingStatus, LodgingUpdate } from '@/lib/api/lodging'
import type { Trip } from '@/lib/api/trips'
import { parsePriceText } from './lodging-meta'

/** Form state: numbers stay strings until saved, so fields can be empty or half-typed. */
export type LodgingDraft = {
  title: string
  url: string
  checkIn: string
  checkOut: string
  guests: string
  price: string
  priceMode: 'total' | 'night'
  currency: string
  photos: string[]
  locationName: string
  bedrooms: string
  beds: string
  baths: string
  rating: string
  reviewCount: string
  notes: string
  pros: string
  cons: string
  status: LodgingStatus
  lat: number | null
  lon: number | null
}

export function newLodgingDraft(init: Partial<LodgingDraft> = {}): LodgingDraft {
  return {
    title: '',
    url: '',
    checkIn: '',
    checkOut: '',
    guests: '',
    price: '',
    priceMode: 'total',
    currency: 'USD',
    photos: [],
    locationName: '',
    bedrooms: '',
    beds: '',
    baths: '',
    rating: '',
    reviewCount: '',
    notes: '',
    pros: '',
    cons: '',
    status: 'candidate',
    lat: null,
    lon: null,
    ...init,
  }
}

const str = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(value))

export function draftFromLodging(option: Lodging): LodgingDraft {
  const byNight = option.price_total === null && option.price_per_night !== null
  return {
    title: option.title,
    url: option.url ?? '',
    checkIn: option.check_in ?? '',
    checkOut: option.check_out ?? '',
    guests: str(option.guests),
    price: str(byNight ? option.price_per_night : option.price_total),
    priceMode: byNight ? 'night' : 'total',
    currency: option.currency ?? option.home_currency,
    photos: option.photos,
    locationName: option.location_name ?? '',
    bedrooms: str(option.bedrooms),
    beds: str(option.beds),
    baths: str(option.baths),
    rating: str(option.rating),
    reviewCount: str(option.review_count),
    notes: option.notes,
    pros: option.pros,
    cons: option.cons,
    status: option.status,
    lat: option.lat,
    lon: option.lon,
  }
}

const number = (value: string) => {
  const trimmed = value.trim().replace(/,/g, '')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function validateLodging(draft: LodgingDraft): string | null {
  if (!draft.title.trim()) return 'Give it a name.'
  const url = draft.url.trim()
  if (url && !/^https?:\/\//i.test(url)) return 'Links must start with http:// or https://'
  if (draft.checkIn && draft.checkOut && draft.checkOut <= draft.checkIn) return 'Check-out must be after check-in.'
  const price = number(draft.price)
  if (Number.isNaN(price) || (price !== null && price <= 0)) return 'The price must be a positive number.'
  if (price !== null && !/^[A-Za-z]{3}$/.test(draft.currency.trim())) return 'Choose the price’s currency.'
  for (const [label, value] of [
    ['Guests', draft.guests],
    ['Bedrooms', draft.bedrooms],
    ['Beds', draft.beds],
    ['Bathrooms', draft.baths],
    ['Reviews', draft.reviewCount],
  ] as const) {
    const n = number(value)
    if (Number.isNaN(n) || (n !== null && n < 0)) return `${label} must be a number.`
  }
  const rating = number(draft.rating)
  if (Number.isNaN(rating) || (rating !== null && (rating < 0 || rating > 5))) return 'Ratings go from 0 to 5.'
  return null
}

type Fields = Omit<LodgingInput, 'added_via' | 'raw'>

function toFields(draft: LodgingDraft): Fields {
  const text = (value: string) => value.trim() || null
  const whole = (value: string) => {
    const n = number(value)
    return n === null || Number.isNaN(n) ? null : Math.round(n)
  }
  const decimal = (value: string) => {
    const n = number(value)
    return n === null || Number.isNaN(n) ? null : String(n)
  }
  const price = decimal(draft.price)
  return {
    title: draft.title.trim(),
    url: text(draft.url),
    check_in: draft.checkIn || null,
    check_out: draft.checkOut || null,
    guests: whole(draft.guests),
    price_total: draft.priceMode === 'total' ? price : null,
    price_per_night: draft.priceMode === 'night' ? price : null,
    currency: price ? draft.currency.trim().toUpperCase() : null,
    photos: draft.photos,
    location_name: text(draft.locationName),
    lat: draft.lat,
    lon: draft.lon,
    bedrooms: whole(draft.bedrooms),
    beds: whole(draft.beds),
    baths: decimal(draft.baths),
    rating: decimal(draft.rating),
    review_count: whole(draft.reviewCount),
    notes: draft.notes.trim(),
    pros: draft.pros.trim(),
    cons: draft.cons.trim(),
    status: draft.status,
  }
}

export function toLodgingInput(
  draft: LodgingDraft,
  addedVia: LodgingInput['added_via'],
  raw?: Record<string, unknown>,
): LodgingInput {
  return { ...toFields(draft), added_via: addedVia, raw: raw ?? null }
}

/** Only what changed. Prices are sent together so the server re-derives the other one. */
export function toLodgingPatch(draft: LodgingDraft, original: Lodging): LodgingUpdate {
  const fields = toFields(draft)
  const before = toFields(draftFromLodging(original))
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(fields) as Array<keyof Fields>) {
    if (JSON.stringify(fields[key]) !== JSON.stringify(before[key])) patch[key] = fields[key]
  }
  if ('price_total' in patch || 'price_per_night' in patch || 'currency' in patch) {
    patch.price_total = fields.price_total
    patch.price_per_night = fields.price_per_night
    patch.currency = fields.currency
  }
  return patch as LodgingUpdate
}

/** What the bookmarklet captured from the listing page, as form values for the chosen trip. */
export function draftFromCapture(params: URLSearchParams, trip: Trip): Partial<LodgingDraft> {
  const get = (key: string) => params.get(key)?.trim() ?? ''
  const price = parsePriceText(get('price'), trip.home_currency)
  const lat = Number(get('lat'))
  const lon = Number(get('lon'))
  const located = get('lat') !== '' && get('lon') !== '' && Number.isFinite(lat) && Number.isFinite(lon)
  return {
    url: get('url'),
    title: get('title').slice(0, 300),
    photos: get('photos').split(/\s+/).filter((p) => /^https?:\/\//.test(p)).slice(0, 12),
    price: price ? String(price.amount) : '',
    priceMode: price?.perNight ? 'night' : 'total',
    currency: price?.currency ?? trip.home_currency,
    rating: get('rating'),
    reviewCount: get('reviews'),
    locationName: get('address').slice(0, 300),
    lat: located ? lat : null,
    lon: located ? lon : null,
    guests: trip.travelers.length ? String(trip.travelers.length) : '',
  }
}
