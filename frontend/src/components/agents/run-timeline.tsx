import {
  BedDouble,
  CircleCheck,
  CircleX,
  ClipboardList,
  CornerDownRight,
  Flag,
  Globe,
  Info,
  Loader2,
  MapPin,
  MessageSquareText,
  Search,
  Sparkles,
  StickyNote,
  Ticket,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { RunEvent } from '@/lib/api/flights'
import { cn } from '@/lib/utils'

const TOOL_ICON: Record<string, LucideIcon> = {
  WebSearch: Search,
  WebFetch: Globe,
  get_task: ClipboardList,
  lookup_airports: MapPin,
  submit_flight_quotes: Ticket,
  suggest_activities: Sparkles,
  suggest_lodging: BedDouble,
  add_note: StickyNote,
  finish_run: Flag,
}

const TYPE_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: 'text-ink-soft' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleX, className: 'text-destructive' },
  text: { icon: MessageSquareText, className: 'text-violet' },
  result: { icon: CircleCheck, className: 'text-success' },
  tool_result: { icon: CornerDownRight, className: 'text-ink-soft' },
  tool_use: { icon: Wrench, className: 'text-foreground' },
}

function style(event: RunEvent) {
  const base = TYPE_STYLE[event.type] ?? TYPE_STYLE.info
  if (event.type === 'tool_use' && event.tool_name) return { ...base, icon: TOOL_ICON[event.tool_name] ?? Wrench }
  return base
}

/** "+2:05" (or "+1:02:05") since the run started. */
function offset(ts: string, startedAt: string | null): string {
  if (!startedAt) return ''
  const total = Math.max(0, Math.round((new Date(ts).getTime() - new Date(startedAt).getTime()) / 1000))
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `+${h}:${pad(m)}:${pad(s)}` : `+${m}:${pad(s)}`
}

function Details({ event }: { event: RunEvent }) {
  const payload = event.payload
  if (!payload) return null
  const content = typeof payload.content === 'string' ? payload.content : null
  const body = content ?? JSON.stringify(payload.input ?? payload, null, 2)
  if (!body.trim()) return null
  return (
    <details className="mt-1 group">
      <summary className="w-fit cursor-pointer text-xs text-ink-soft hover:text-foreground">Details</summary>
      <pre className="type-data mt-1 max-h-80 overflow-auto rounded-md bg-muted p-2.5 text-xs break-all whitespace-pre-wrap">
        {body}
      </pre>
    </details>
  )
}

type Props = { events: RunEvent[]; startedAt: string | null; live: boolean }

/** The run's log, oldest first. While the run is live, new lines stay in view if you're at the end. */
export function RunTimeline({ events, startedAt, live }: Props) {
  const endRef = useRef<HTMLLIElement>(null)
  const followRef = useRef(true)

  useEffect(() => {
    const onScroll = () => {
      followRef.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (live && followRef.current) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [events.length, live])

  if (events.length === 0 && !live) return <p className="text-sm text-ink-soft">Nothing was logged for this run.</p>

  return (
    <ol aria-label="Run log" className="text-sm">
      {events.map((event) => {
        const { icon: Icon, className } = style(event)
        return (
          <li
            key={event.seq}
            className={cn(
              'grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] gap-x-2 py-1.5',
              event.type === 'tool_result' && 'text-ink-soft',
            )}
          >
            <span className="type-data pt-0.5 text-right text-xs text-ink-soft">{offset(event.ts, startedAt)}</span>
            <Icon className={cn('mt-0.5 size-4', className)} aria-hidden="true" />
            <div className="min-w-0">
              <p
                className={cn(
                  'break-words',
                  event.type === 'text' && 'whitespace-pre-wrap',
                  event.type === 'error' && 'font-semibold text-destructive',
                )}
              >
                {event.summary}
              </p>
              <Details event={event} />
            </div>
          </li>
        )
      })}
      {live && (
        <li ref={endRef} className="grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] gap-x-2 py-1.5 text-ink-soft">
          <span />
          <Loader2 className="mt-0.5 size-4 animate-spin text-violet" aria-hidden="true" />
          <span>Working…</span>
        </li>
      )}
    </ol>
  )
}
