import type { TripStatus } from '@/lib/api/trips'
import { STATUS_LABELS } from '@/lib/trip-status'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<TripStatus, string> = {
  planning: 'border-brand/30 bg-brand-soft text-brand',
  booked: 'border-success/30 bg-success/10 text-success',
  done: 'border-border bg-muted text-ink-soft',
  archived: 'border-dashed border-border text-ink-soft',
}

export function TripStatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
