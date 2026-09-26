import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { api, unwrap } from '@/lib/api/client'
import { useSystemStatus, type SystemStatus } from '@/lib/api/system'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'bad'
type Item = { tone: Tone; text: string }

const DOT: Record<Tone, string> = { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-destructive' }

function items(status: SystemStatus): Item[] {
  const { claude, worker, integrations } = status
  const version = claude.version ? ` ${claude.version}` : ''
  const claudeItem: Item = !claude.found
    ? { tone: 'bad', text: 'Claude Code not found' }
    : claude.signed_in === false
      ? { tone: 'bad', text: `Claude Code${version} is signed out` }
      : claude.signed_in === null
        ? { tone: 'warn', text: `Claude Code${version} (couldn't check sign-in)` }
        : { tone: 'ok', text: `Claude Code${version}, signed in` }
  return [
    claudeItem,
    worker.status === 'ok'
      ? { tone: 'ok', text: 'Scheduler running' }
      : { tone: 'warn', text: "Background worker isn't running" },
    integrations.agent_api
      ? { tone: 'ok', text: 'Agent API key set' }
      : { tone: 'bad', text: 'AGENT_INGEST_API_KEY missing from .env' },
  ]
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="type-data flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}

/** What agents need in order to run, and how to fix whatever is missing. */
export function AgentStatus() {
  const status = useSystemStatus()
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(false)

  const recheck = async () => {
    setChecking(true)
    try {
      const fresh = unwrap(await api.GET('/api/v1/system/status', { params: { query: { recheck: true } } }))
      queryClient.setQueryData(['system-status'], fresh)
    } finally {
      setChecking(false)
    }
  }

  if (!status.data) return null
  const data = status.data
  const signedOut = data.claude.found && data.claude.signed_in === false

  return (
    <div className="space-y-3">
      <ul aria-label="What agents need" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {items(data).map((item) => (
          <li key={item.text} className="flex items-center gap-2">
            <span className={cn('size-2 shrink-0 rounded-full', DOT[item.tone])} aria-hidden="true" />
            {item.text}
          </li>
        ))}
        <li>
          <Button variant="ghost" size="sm" onClick={recheck} disabled={checking} className="text-ink-soft">
            <RefreshCw aria-hidden="true" className={checking ? 'animate-spin' : undefined} />
            Check again
          </Button>
        </li>
      </ul>

      {signedOut && (
        <section aria-labelledby="sign-in-heading" className="rounded-xl border border-warning/40 bg-card p-5">
          <h2 id="sign-in-heading" className="type-heading">
            Sign Claude Code in to run agents
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            Agents run on your Claude subscription through Claude Code on this PC, and it's signed out. Routines will
            fail until you sign in.
          </p>
          <ol className="mt-4 space-y-2.5 text-sm">
            <Step n={1}>Open PowerShell or Terminal on this PC.</Step>
            <Step n={2}>
              Run <code className="type-data rounded bg-muted px-1.5 py-0.5">claude</code>, then type{' '}
              <code className="type-data rounded bg-muted px-1.5 py-0.5">/login</code> and finish signing in in your
              browser.
            </Step>
            <Step n={3}>Come back here and choose Check again.</Step>
          </ol>
        </section>
      )}

      {!data.claude.found && (
        <p className="max-w-prose text-sm text-ink-soft">
          Install Claude Code, or set <code className="type-data">CLAUDE_PATH</code> in .env to the full path of{' '}
          <code className="type-data">claude.exe</code>, then restart the app.
        </p>
      )}
    </div>
  )
}
