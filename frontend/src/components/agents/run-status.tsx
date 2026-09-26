import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '@/lib/api/agents'
import { cn } from '@/lib/utils'
import { RUN_STATUS, TONE_TEXT } from './run-meta'

export function StatusIcon({ status, className }: { status: RunStatus; className?: string }) {
  const { icon: Icon, tone } = RUN_STATUS[status]
  return (
    <Icon
      className={cn('size-4 shrink-0', TONE_TEXT[tone], status === 'running' && 'animate-spin', className)}
      aria-hidden="true"
    />
  )
}

/** Icon plus words, for lists. Color is never the only signal. */
export function StatusLabel({ status, className }: { status: RunStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', className)}>
      <StatusIcon status={status} />
      {RUN_STATUS[status].label}
    </span>
  )
}

const stampDate = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * The run's outcome as a passport entry stamp. It presses in once when a run you're watching
 * finishes; on load it's simply there.
 */
export function RunStamp({ status, at }: { status: RunStatus; at: string }) {
  const { label, tone } = RUN_STATUS[status]
  const previous = useRef(status)
  const [pressed, setPressed] = useState(false)
  useEffect(() => {
    const wasRunning = previous.current === 'running' || previous.current === 'queued'
    if (wasRunning && status !== 'running' && status !== 'queued') setPressed(true)
    previous.current = status
  }, [status])

  return (
    <div
      role="img"
      aria-label={`${label}, ${stampDate.format(new Date(at))}`}
      className={cn(
        'inline-flex -rotate-3 flex-col items-center rounded-md border-2 border-current px-3 py-1 leading-none shadow-[0_0_0_2px_var(--card),0_0_0_3px_currentColor] select-none',
        TONE_TEXT[tone],
        pressed && 'motion-safe:animate-[stamp-press_280ms_cubic-bezier(0.2,0.9,0.3,1.2)]',
      )}
    >
      <span className="type-label text-[0.75rem]">{label}</span>
      <span className="type-data mt-1 text-[0.6875rem] tracking-wide uppercase opacity-80">
        {stampDate.format(new Date(at))}
      </span>
    </div>
  )
}
