import { afterEach, describe, expect, it, vi } from 'vitest'
import { lodging, trip } from '@/test/fixtures'
import {
  draftFromCapture,
  draftFromLodging,
  newLodgingDraft,
  toLodgingInput,
  toLodgingPatch,
  validateLodging,
} from './lodging-form'
import { bookmarkletCode, parsePriceText, perPerson } from './lodging-meta'

describe('parsePriceText', () => {
  it.each([
    ['$1,234 total', 'USD', { amount: 1234, currency: 'USD', perNight: false }],
    ['¥18,500 / night', 'USD', { amount: 18500, currency: 'JPY', perNight: true }],
    ['JP¥18,500 night', 'USD', { amount: 18500, currency: 'JPY', perNight: true }],
    ['US$ 99 night', 'EUR', { amount: 99, currency: 'USD', perNight: true }],
    ['€1.234,56 total', 'USD', { amount: 1234.56, currency: 'EUR', perNight: false }],
    ['£89.50 night', 'USD', { amount: 89.5, currency: 'GBP', perNight: true }],
  ])('reads %s', (text, home, expected) => {
    expect(parsePriceText(text, home)).toEqual(expected)
  })

  it('treats a bare $ as the trip’s own dollar', () => {
    expect(parsePriceText('$450 total', 'CAD')?.currency).toBe('CAD')
    expect(parsePriceText('$450 total', 'EUR')?.currency).toBe('USD')
  })

  it('gives up without a currency symbol or a positive amount', () => {
    expect(parsePriceText('', 'USD')).toBeNull()
    expect(parsePriceText('about 400 total', 'USD')).toBeNull()
    expect(parsePriceText('$0 total', 'USD')).toBeNull()
  })
})

describe('perPerson', () => {
  it('splits the converted total over the party, or the travelers without one', () => {
    expect(perPerson(lodging(), 1)).toBe(320)
    expect(perPerson(lodging({ guests: null }), 4)).toBe(160)
    expect(perPerson(lodging({ price_home_total: null }), 2)).toBeNull()
    expect(perPerson(lodging({ guests: null }), 0)).toBeNull()
  })
})

describe('validateLodging', () => {
  const valid = newLodgingDraft({ title: 'Machiya', price: '32,000', currency: 'JPY' })

  it('accepts a named place with a priced currency', () => {
    expect(validateLodging(valid)).toBeNull()
  })

  it.each([
    [{ title: ' ' }, 'Give it a name.'],
    [{ url: 'www.airbnb.com/rooms/1' }, 'Links must start with http:// or https://'],
    [{ checkIn: '2026-11-12', checkOut: '2026-11-09' }, 'Check-out must be after check-in.'],
    [{ price: '-5' }, 'The price must be a positive number.'],
    [{ price: 'cheap' }, 'The price must be a positive number.'],
    [{ currency: '' }, 'Choose the price’s currency.'],
    [{ guests: 'two' }, 'Guests must be a number.'],
    [{ rating: '6' }, 'Ratings go from 0 to 5.'],
  ])('rejects %o', (change, message) => {
    expect(validateLodging({ ...valid, ...change })).toBe(message)
  })
})

describe('toLodgingInput', () => {
  it('sends numbers as numbers, blanks as nulls, and the price in the mode it was typed', () => {
    const draft = newLodgingDraft({
      title: ' Machiya ',
      price: '32,000',
      priceMode: 'night',
      currency: 'jpy',
      guests: '2',
      baths: '1.5',
      notes: ' Quiet street ',
    })
    expect(toLodgingInput(draft, 'paste')).toMatchObject({
      title: 'Machiya',
      url: null,
      price_total: null,
      price_per_night: '32000',
      currency: 'JPY',
      guests: 2,
      baths: '1.5',
      bedrooms: null,
      notes: 'Quiet street',
      added_via: 'paste',
      raw: null,
    })
  })

  it('leaves the currency off when there is no price', () => {
    expect(toLodgingInput(newLodgingDraft({ title: 'Machiya' }), 'manual').currency).toBeNull()
  })
})

describe('toLodgingPatch', () => {
  it('sends only what changed', () => {
    const original = lodging()
    const draft = { ...draftFromLodging(original), title: 'Garden machiya', rating: '4.8' }
    expect(toLodgingPatch(draft, original)).toEqual({ title: 'Garden machiya', rating: '4.8' })
  })

  it('sends the whole price together, so the server re-derives the nightly rate', () => {
    const original = lodging()
    const draft = { ...draftFromLodging(original), price: '90000' }
    expect(toLodgingPatch(draft, original)).toEqual({
      price_total: '90000',
      price_per_night: null,
      currency: 'JPY',
    })
  })
})

describe('draftFromCapture', () => {
  it('turns what the bookmarklet read into form values', () => {
    const params = new URLSearchParams({
      url: 'https://www.airbnb.com/rooms/4455?check_in=2026-11-09',
      title: '  Tea house in Arashiyama ',
      photos: 'https://a.example/1.jpg javascript:alert(1) https://a.example/2.jpg',
      price: '¥18,500 night',
      rating: '4.97',
      reviews: '312',
      lat: '35.0094',
      lon: '135.6668',
      address: 'Arashiyama, Kyoto',
    })
    expect(draftFromCapture(params, trip())).toEqual({
      url: 'https://www.airbnb.com/rooms/4455?check_in=2026-11-09',
      title: 'Tea house in Arashiyama',
      photos: ['https://a.example/1.jpg', 'https://a.example/2.jpg'],
      price: '18500',
      priceMode: 'night',
      currency: 'JPY',
      rating: '4.97',
      reviewCount: '312',
      locationName: 'Arashiyama, Kyoto',
      lat: 35.0094,
      lon: 135.6668,
      guests: '1',
    })
  })

  it('falls back to the trip’s currency and no location when the page showed neither', () => {
    const draft = draftFromCapture(new URLSearchParams({ title: 'Somewhere', lat: 'north' }), trip())
    expect(draft).toMatchObject({ price: '', priceMode: 'total', currency: 'USD', lat: null, lon: null })
  })
})

describe('bookmarkletCode', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    Reflect.deleteProperty(document.body, 'innerText')
    vi.restoreAllMocks()
  })

  it('reads the listing you have open and opens the import form with it', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Tea house in Arashiyama">
      <meta property="og:image" content="https://a.example/cover.jpg">
      <script type="application/ld+json">
        {"@type": "LodgingBusiness", "name": "Tea house", "image": ["https://a.example/cover.jpg", {"url": "https://a.example/2.jpg"}],
         "aggregateRating": {"ratingValue": 4.97, "reviewCount": 312},
         "geo": {"latitude": 35.0094, "longitude": 135.6668},
         "address": {"streetAddress": "12 Saga", "addressLocality": "Kyoto"}}
      </script>`
    // jsdom doesn't lay out text, so give the page the words a browser would show.
    Object.defineProperty(document.body, 'innerText', { value: 'Tea house\n¥18,500 night\nReserve', configurable: true })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    const code = bookmarkletCode('http://192.168.1.20:8000')
    expect(code.startsWith('javascript:')).toBe(true)
    new Function(decodeURIComponent(code.slice('javascript:'.length)))()

    expect(open).toHaveBeenCalledOnce()
    const [target, name] = open.mock.calls[0]
    expect(name).toBe('_blank')
    const opened = new URL(String(target))
    expect(opened.origin + opened.pathname).toBe('http://192.168.1.20:8000/lodging/import')
    expect(Object.fromEntries(opened.searchParams)).toEqual({
      url: window.location.href,
      title: 'Tea house in Arashiyama',
      photos: 'https://a.example/cover.jpg https://a.example/2.jpg',
      price: '¥18,500 night',
      rating: '4.97',
      reviews: '312',
      lat: '35.0094',
      lon: '135.6668',
      address: '12 Saga, Kyoto',
    })
  })
})
