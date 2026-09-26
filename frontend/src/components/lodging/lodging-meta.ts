import type { Lodging, LodgingStatus } from '@/lib/api/lodging'

export const STATUS: Record<LodgingStatus, { label: string; tone: string }> = {
  candidate: { label: 'Considering', tone: 'text-ink-soft' },
  shortlisted: { label: 'Shortlisted', tone: 'text-violet' },
  booked: { label: 'Booked', tone: 'text-success' },
  rejected: { label: 'Not for us', tone: 'text-ink-soft' },
}

export const STATUS_ORDER: LodgingStatus[] = ['candidate', 'shortlisted', 'booked', 'rejected']

/** Price per person in the trip's currency: the converted total over the party (or the travelers). */
export function perPerson(option: Lodging, travelers: number): number | null {
  const people = option.guests ?? travelers
  if (option.price_home_total === null || !people) return null
  return Number(option.price_home_total) / people
}

// --- Bookmarklet ---------------------------------------------------------------------------------

/**
 * A bookmark that, clicked on a listing you're viewing, reads what that page already shows (title,
 * photos, price text, rating) and opens Trip Planner's import form with it. Nothing is fetched by
 * the app: it's your own browser, on the page you opened.
 */
export function bookmarkletCode(appOrigin: string): string {
  const script = `(()=>{
const q=s=>document.querySelector(s);
const meta=n=>{const e=q('meta[property="'+n+'"]')||q('meta[name="'+n+'"]');return e?e.content||'':''};
let ld={};
document.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{try{[].concat(JSON.parse(s.textContent)).forEach(o=>{if(o&&!ld.name&&(o.name||o.image))ld=o})}catch(e){}});
const imgs=[meta('og:image')].concat(ld.image?[].concat(ld.image).map(i=>typeof i==='string'?i:(i&&i.url)):[]).filter(Boolean);
const text=document.body?document.body.innerText:'';
const price=(text.match(/(?:US\\$|JP¥|CA\\$|A\\$|[$€£¥₩])\\s?[\\d,.]+\\s*(?:total|night|\\/\\s*night)/i)||[''])[0];
const r=ld.aggregateRating||{},g=ld.geo||{},a=ld.address||{};
const p=new URLSearchParams({url:location.href,title:meta('og:title')||ld.name||document.title,photos:[...new Set(imgs)].slice(0,6).join(' '),price:price,rating:r.ratingValue||'',reviews:r.reviewCount||r.ratingCount||'',lat:g.latitude||'',lon:g.longitude||'',address:[a.streetAddress,a.addressLocality].filter(Boolean).join(', ')});
window.open(${JSON.stringify(appOrigin)}+'/lodging/import?'+p.toString(),'_blank');
})()`
  return `javascript:${encodeURIComponent(script.replace(/\n/g, ''))}`
}

const SYMBOLS: Array<[RegExp, string | null]> = [
  [/^US\$/, 'USD'],
  [/^CA\$/, 'CAD'],
  [/^A\$/, 'AUD'],
  [/^JP¥/, 'JPY'],
  [/^€/, 'EUR'],
  [/^£/, 'GBP'],
  [/^₩/, 'KRW'],
  [/^¥/, 'JPY'],
  // A bare $ could be several dollars; the trip's own currency decides when it's a dollar.
  [/^\$/, null],
]

/** "$1,234 total" or "¥12,000 / night", as captured by the bookmarklet. */
export function parsePriceText(
  text: string,
  homeCurrency: string,
): { amount: number; currency: string; perNight: boolean } | null {
  const trimmed = text.trim()
  const match = trimmed.match(/[\d][\d,.]*/)
  if (!match) return null
  const symbol = SYMBOLS.find(([pattern]) => pattern.test(trimmed))
  if (!symbol) return null
  const currency = symbol[1] ?? (homeCurrency.endsWith('D') ? homeCurrency : 'USD')
  // JPY and KRW prices have no decimals; elsewhere a trailing ",dd" or ".dd" is cents.
  const digits = match[0].replace(/[,.](?=\d{3}\b)/g, '').replace(',', '.')
  const amount = Number(digits)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { amount, currency, perNight: /night/i.test(trimmed) }
}
