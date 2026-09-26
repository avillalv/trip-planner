import { ExternalLink, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentNote, Rejection, RunOutputs } from '@/lib/api/agents'
import type { Quote } from '@/lib/api/flights'
import { formatDateRange, parseDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-brand underline-offset-2 hover:underline"
    >
      {hostOf(url)}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  )
}

function QuoteRow({ quote }: { quote: Quote }) {
  const dates = quote.return_date
    ? formatDateRange(quote.depart_date, quote.return_date)
    : day.format(parseDate(quote.depart_date))
  const home = quote.price_home !== null
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0">
        <p className="font-semibold">
          <span className="type-code">
            {quote.origin} → {quote.destination}
          </span>
          <span className="font-normal text-ink-soft"> · {dates}</span>
        </p>
        <p className="text-sm text-ink-soft">
          {[quote.airlines.join(', '), `${quote.passengers} ${quote.passengers === 1 ? 'traveler' : 'travelers'}`]
            .filter(Boolean)
            .join(' · ')}
          {quote.source_url && (
            <>
              {' · '}
              <SourceLink url={quote.source_url} />
            </>
          )}
        </p>
        {quote.suspect && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-warning">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            Far from recent prices, so it's left out of the best options until you check it.
          </p>
        )}
      </div>
      <p className="type-data text-base font-semibold">
        {formatMoney(home ? quote.price_home : quote.price_total, home ? quote.home_currency : quote.currency)}
      </p>
    </li>
  )
}

export function NoteCard({ note, action }: { note: AgentNote; action?: ReactNode }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-semibold">{note.title}</h4>
        {action}
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap">{note.body}</p>
      {note.urls.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {note.urls.map((url) => (
            <SourceLink key={url} url={url} />
          ))}
        </p>
      )}
    </li>
  )
}

export function SavedOutputs({ outputs }: { outputs: RunOutputs }) {
  if (outputs.quotes.length === 0 && outputs.notes.length === 0) {
    return <p className="text-sm text-ink-soft">This run didn't save any prices or notes.</p>
  }
  return (
    <div className="space-y-6">
      {outputs.quotes.length > 0 && (
        <section aria-labelledby="saved-prices">
          <h3 id="saved-prices" className="type-label text-ink-soft">
            Prices
          </h3>
          <ul className="mt-1 divide-y">
            {outputs.quotes.map((quote) => (
              <QuoteRow key={quote.id} quote={quote} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">
            Agent prices are marked “indicative”: seen on the linked page, but not live-checked. Open the link before
            booking.
          </p>
        </section>
      )}
      {outputs.notes.length > 0 && (
        <section aria-labelledby="saved-notes">
          <h3 id="saved-notes" className="type-label text-ink-soft">
            Notes
          </h3>
          <ul className="mt-2 space-y-3">
            {outputs.notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const FIELD_NAMES: Record<string, string> = {
  route_id: 'Route',
  origin: 'From',
  destination: 'To',
  depart_date: 'Departure',
  return_date: 'Return',
  price_total: 'Price',
  currency: 'Currency',
  passengers: 'Travelers',
  source_url: 'Link',
  observed_at: 'Seen at',
  urls: 'Links',
}

function fieldName(field: string): string {
  const [head, ...rest] = field.split('.')
  if (/^\d+$/.test(head) && rest.length) return fieldName(rest.join('.'))
  return FIELD_NAMES[head] ?? head.replaceAll('_', ' ')
}

function describeItem(item: Record<string, unknown>): string {
  const text = (key: string) => (item[key] === undefined || item[key] === null ? '' : String(item[key]))
  const parts = []
  if (text('origin') || text('destination')) parts.push(`${text('origin') || '?'} → ${text('destination') || '?'}`)
  if (text('depart_date')) parts.push(text('return_date') ? `${text('depart_date')} to ${text('return_date')}` : text('depart_date'))
  if (text('price_total')) parts.push(`${text('currency')} ${text('price_total')}`.trim())
  if (text('title')) parts.push(`“${text('title')}”`)
  return parts.join(' · ') || 'Submitted item'
}

export function RejectionList({ rejections }: { rejections: Rejection[] }) {
  if (rejections.length === 0) return <p className="text-sm text-ink-soft">Everything this run submitted passed the checks.</p>
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-ink-soft">
        The app checks everything an agent submits. These didn't pass, so they weren't saved.
      </p>
      <ul className="divide-y rounded-xl border bg-card">
        {rejections.map((rejection) => {
          const source = typeof rejection.item.source_url === 'string' ? rejection.item.source_url : null
          return (
            <li key={rejection.id} className="px-4 py-3">
              <p className="font-semibold">{describeItem(rejection.item)}</p>
              {source && (
                <p className="text-sm text-ink-soft">
                  From <span className="break-all">{source}</span>
                </p>
              )}
              <ul className="mt-1.5 space-y-0.5 text-sm">
                {rejection.errors.map((error, i) => (
                  <li key={i}>
                    <span className="font-semibold">{fieldName(error.field)}</span>
                    {/^[A-Z]/.test(error.msg) ? `: ${error.msg}` : ` ${error.msg}`}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
