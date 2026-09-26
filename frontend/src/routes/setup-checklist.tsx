import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemStatus, type SystemStatus } from '@/lib/api/system'
import { timeAgo } from '@/lib/format'

type State = 'ready' | 'missing' | 'problem'

type Item = { label: string; state: State; detail: ReactNode }

const ICON: Record<State, ReactNode> = {
  ready: <CircleCheck className="size-5 text-success" aria-hidden="true" />,
  missing: <CircleDashed className="size-5 text-ink-soft" aria-hidden="true" />,
  problem: <CircleAlert className="size-5 text-destructive" aria-hidden="true" />,
}

const STATE_TEXT: Record<State, string> = { ready: 'Ready', missing: 'Not set up', problem: 'Needs attention' }

const Env = ({ children }: { children: ReactNode }) => (
  <code className="type-data rounded bg-muted px-1 py-0.5 text-[0.8em] text-ink">{children}</code>
)

function coreItems(s: SystemStatus): Item[] {
  const worker = s.worker
  let workerItem: Item
  if (worker.status === 'ok' && worker.last_seen) {
    workerItem = { label: 'Background worker', state: 'ready', detail: `Running · checked in ${timeAgo(worker.last_seen)}` }
  } else if (worker.status === 'stale' && worker.last_seen) {
    workerItem = {
      label: 'Background worker',
      state: 'problem',
      detail: <>Stopped responding {timeAgo(worker.last_seen)}. Restart the app with <Env>npm start</Env>.</>,
    }
  } else {
    workerItem = {
      label: 'Background worker',
      state: 'problem',
      detail: <>Not running. Start the app with <Env>npm start</Env>.</>,
    }
  }
  return [
    s.database === 'ok'
      ? { label: 'Database', state: 'ready', detail: 'Connected' }
      : { label: 'Database', state: 'problem', detail: 'Unavailable. Check that the PostgreSQL service is running.' },
    workerItem,
  ]
}

function connectionItems(s: SystemStatus): Item[] {
  const key = (name: string, configured: boolean, purpose: string): Item =>
    configured
      ? { label: name, state: 'ready', detail: 'Key added' }
      : { label: name, state: 'missing', detail: purpose }
  return [
    s.claude.found
      ? { label: 'Claude Code', state: 'ready', detail: `Found · version ${s.claude.version ?? 'unknown'}` }
      : {
          label: 'Claude Code',
          state: 'missing',
          detail: <>Not found. Install Claude Code, or set <Env>CLAUDE_PATH</Env> in .env.</>,
        },
    key('Geoapify', s.integrations.geoapify, 'Add GEOAPIFY_API_KEY to .env to search for places.'),
    key('SerpApi', s.integrations.serpapi, 'Add SERPAPI_API_KEY to .env for live Google Flights prices.'),
    key('Travelpayouts', s.integrations.travelpayouts, 'Add TRAVELPAYOUTS_TOKEN to .env for cached fare calendars.'),
  ]
}

function ItemList({ title, items }: { title: string; items: Item[] }) {
  return (
    <div>
      <h3 className="type-label mb-1 text-ink-soft">{title}</h3>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-3 py-3">
            <span className="mt-0.5">{ICON[item.state]}</span>
            <div className="min-w-0">
              <p className="font-semibold">
                {item.label}
                <span className="sr-only">: {STATE_TEXT[item.state]}</span>
              </p>
              <p className="text-sm text-ink-soft">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SetupChecklist() {
  const { data, isPending, isError } = useSystemStatus()

  if (isError) {
    return (
      <p className="flex items-start gap-3 text-sm">
        {ICON.problem}
        <span>
          Can't reach the Trip Planner server. Start it with <Env>npm start</Env>, then reload this page.
        </span>
      </p>
    )
  }
  if (isPending) {
    return (
      <div className="space-y-3" aria-label="Loading setup status">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  const core = coreItems(data)
  const connections = connectionItems(data)
  const ready = [...core, ...connections].filter((i) => i.state === 'ready').length

  return (
    <div className="space-y-5">
      <p className="type-data text-sm text-ink-soft">
        {ready} of {core.length + connections.length} ready
      </p>
      <ItemList title="Core" items={core} />
      <ItemList title="Connections" items={connections} />
      <p className="text-xs text-ink-soft">After editing .env, restart the app so it picks up the change.</p>
    </div>
  )
}
