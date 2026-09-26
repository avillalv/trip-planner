import { useSystemStatus } from '@/lib/api/system'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'bad' | 'idle'

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  idle: 'bg-cover-soft',
}

/** One-line server health for the nav rail; details live on the setup checklist. */
export function SystemStatusIndicator() {
  const { data, isPending, isError } = useSystemStatus()

  let tone: Tone = 'idle'
  let text = 'Checking the server…'
  if (isError) {
    tone = 'bad'
    text = 'Server unreachable'
  } else if (!isPending && data) {
    if (data.database !== 'ok') {
      tone = 'bad'
      text = 'Database unavailable'
    } else if (data.worker.status !== 'ok') {
      tone = 'warn'
      text = 'Background worker stopped'
    } else {
      tone = 'ok'
      text = 'Everything running'
    }
  }

  return (
    <p role="status" className="flex items-center gap-2 text-xs text-cover-soft">
      <span className={cn('size-2 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
      {text}
    </p>
  )
}
