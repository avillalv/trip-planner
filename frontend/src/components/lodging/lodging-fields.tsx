import { X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { currencyOptions } from '@/lib/currencies'
import { cn } from '@/lib/utils'
import type { LodgingDraft } from './lodging-form'
import { STATUS, STATUS_ORDER } from './lodging-meta'

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </Label>
      {children}
    </div>
  )
}

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

type Props = { draft: LodgingDraft; onChange: (patch: Partial<LodgingDraft>) => void }

export function LodgingFields({ draft, onChange }: Props) {
  const [photoLink, setPhotoLink] = useState('')
  const addPhoto = () => {
    const link = photoLink.trim()
    if (/^https?:\/\//i.test(link) && !draft.photos.includes(link)) onChange({ photos: [...draft.photos, link] })
    setPhotoLink('')
  }

  return (
    <div className="space-y-4">
      <Field label="Name" htmlFor="lodging-title">
        <Input
          id="lodging-title"
          value={draft.title}
          maxLength={300}
          placeholder="Machiya with a garden in Gion"
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Check-in" htmlFor="lodging-in">
          <Input id="lodging-in" type="date" value={draft.checkIn} onChange={(e) => onChange({ checkIn: e.target.value })} />
        </Field>
        <Field label="Check-out" htmlFor="lodging-out">
          <Input id="lodging-out" type="date" value={draft.checkOut} onChange={(e) => onChange({ checkOut: e.target.value })} />
        </Field>
        <Field label="Guests" htmlFor="lodging-guests">
          <Input id="lodging-guests" inputMode="numeric" value={draft.guests} onChange={(e) => onChange({ guests: e.target.value })} />
        </Field>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold">Price</legend>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Price"
            inputMode="decimal"
            className="w-32"
            value={draft.price}
            placeholder="0"
            onChange={(e) => onChange({ price: e.target.value })}
          />
          <select
            aria-label="Currency"
            className={cn(selectClass, 'w-28')}
            value={draft.currency}
            onChange={(e) => onChange({ currency: e.target.value })}
          >
            {currencyOptions().map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <div role="radiogroup" aria-label="Price is" className="flex rounded-lg border p-0.5">
            {(['total', 'night'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={draft.priceMode === mode}
                onClick={() => onChange({ priceMode: mode })}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm',
                  draft.priceMode === mode ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-soft hover:bg-accent',
                )}
              >
                {mode === 'total' ? 'Total' : 'Per night'}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        <Field label="Bedrooms" htmlFor="lodging-bedrooms">
          <Input id="lodging-bedrooms" inputMode="numeric" value={draft.bedrooms} onChange={(e) => onChange({ bedrooms: e.target.value })} />
        </Field>
        <Field label="Beds" htmlFor="lodging-beds">
          <Input id="lodging-beds" inputMode="numeric" value={draft.beds} onChange={(e) => onChange({ beds: e.target.value })} />
        </Field>
        <Field label="Baths" htmlFor="lodging-baths">
          <Input id="lodging-baths" inputMode="decimal" value={draft.baths} onChange={(e) => onChange({ baths: e.target.value })} />
        </Field>
        <Field label="Rating" htmlFor="lodging-rating">
          <Input id="lodging-rating" inputMode="decimal" placeholder="4.8" value={draft.rating} onChange={(e) => onChange({ rating: e.target.value })} />
        </Field>
        <Field label="Reviews" htmlFor="lodging-reviews">
          <Input id="lodging-reviews" inputMode="numeric" value={draft.reviewCount} onChange={(e) => onChange({ reviewCount: e.target.value })} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Area or address (optional)" htmlFor="lodging-location">
          <Input
            id="lodging-location"
            value={draft.locationName}
            maxLength={300}
            onChange={(e) => onChange({ locationName: e.target.value })}
          />
        </Field>
        <Field label="Status" htmlFor="lodging-status">
          <select
            id="lodging-status"
            className={selectClass}
            value={draft.status}
            onChange={(e) => onChange({ status: e.target.value as LodgingDraft['status'] })}
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS[status].label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Photos</p>
        {draft.photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {draft.photos.map((photo) => (
              <li key={photo} className="relative">
                <img src={photo} alt="" referrerPolicy="no-referrer" className="size-16 rounded-md border object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => onChange({ photos: draft.photos.filter((p) => p !== photo) })}
                  className="absolute -top-1.5 -right-1.5 rounded-full border bg-card p-0.5"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            aria-label="Photo link"
            placeholder="Paste a photo's link"
            value={photoLink}
            onChange={(e) => setPhotoLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPhoto()
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addPhoto} disabled={!photoLink.trim()}>
            Add
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pros" htmlFor="lodging-pros">
          <Textarea id="lodging-pros" rows={2} maxLength={2000} value={draft.pros} onChange={(e) => onChange({ pros: e.target.value })} />
        </Field>
        <Field label="Cons" htmlFor="lodging-cons">
          <Textarea id="lodging-cons" rows={2} maxLength={2000} value={draft.cons} onChange={(e) => onChange({ cons: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="lodging-notes">
        <Textarea id="lodging-notes" rows={2} maxLength={4000} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </div>
  )
}
