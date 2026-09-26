import { Copy, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/people/person-avatar'
import { PersonEditor } from '@/components/people/person-editor'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeletePerson, usePeople, type Person } from '@/lib/api/people'
import { useAppSettings, useUpdateAppSettings } from '@/lib/api/settings'
import { useBackUpNow, useSystemStatus } from '@/lib/api/system'
import { currencyOptions } from '@/lib/currencies'
import { formatBytes } from '@/lib/format'
import { SetupChecklist } from './setup-checklist'

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card p-5 md:p-6">
      <h2 id={id} className="type-heading">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function TravelersSection() {
  const people = usePeople()
  const remove = useDeletePerson()
  // The person stays set while the dialog animates closed, so its title doesn't flicker.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Person | undefined>()
  const [removing, setRemoving] = useState<Person | null>(null)
  const openEditor = (person?: Person) => {
    setEditing(person)
    setEditorOpen(true)
  }

  return (
    <Section id="travelers-heading" title="Travelers" description="People you can add to trips.">
      {people.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : (people.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-soft">No travelers yet.</p>
      ) : (
        <ul className="divide-y">
          {people.data!.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-3">
              <PersonAvatar person={person} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{person.name}</p>
                <p className="text-sm text-ink-soft">
                  {person.home_airports.length > 0 ? (
                    <>
                      Flies from <span className="type-code">{person.home_airports.join(' · ')}</span>
                    </>
                  ) : (
                    'No home airport yet'
                  )}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => openEditor(person)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(person)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" className="mt-3" onClick={() => openEditor()}>
        <Plus aria-hidden="true" />
        Add traveler
      </Button>

      <PersonEditor open={editorOpen} onOpenChange={setEditorOpen} person={editing} />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They'll be taken off every trip they're on.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                removing &&
                remove.mutate(removing.id, {
                  onSuccess: () => toast.success(`Removed ${removing.name}`),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}

function CurrencySection() {
  const settings = useAppSettings()
  const update = useUpdateAppSettings()
  return (
    <Section id="currency-heading" title="Home currency" description="New trips start with this currency.">
      <select
        aria-labelledby="currency-heading"
        value={settings.data?.home_currency ?? ''}
        disabled={!settings.data || update.isPending}
        onChange={(e) =>
          update.mutate(
            { home_currency: e.target.value },
            { onSuccess: (s) => toast.success(`Home currency set to ${s.home_currency}`) },
          )
        }
        className="h-9 w-full max-w-sm rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {currencyOptions().map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </select>
    </Section>
  )
}

const firewallCommand = (port: number) =>
  `New-NetFirewallRule -DisplayName "Trip Planner (LAN)" -Direction Inbound -Protocol TCP -LocalPort ${port} -Profile Private -Action Allow`

function CopyableCode({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background p-2">
      <code className="type-data min-w-0 flex-1 text-xs break-all">{text}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy"
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => toast.success('Copied'),
            () => toast.error("Couldn't copy. Select the text instead."),
          )
        }
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  )
}

function OtherDevicesSection() {
  const status = useSystemStatus()
  const access = status.data?.access
  if (!access) return null

  if (access.other_devices) {
    return (
      <Section id="devices-heading" title="Other devices" description="Phones and laptops on your Wi-Fi can open Trip Planner.">
        {!access.passcode_configured && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Set APP_PASSCODE in .env and restart; other devices can't sign in without it.
          </p>
        )}
        <p className="text-sm">Open one of these addresses on a device connected to the same Wi-Fi:</p>
        <ul className="mt-2 space-y-2">
          {access.urls.map((url) => (
            <li key={url}>
              <CopyableCode text={url} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-soft">Each device asks for the passcode once, then stays signed in for 30 days.</p>
      </Section>
    )
  }

  return (
    <Section id="devices-heading" title="Other devices" description="Only this computer can open Trip Planner right now.">
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          In <code className="type-data">.env</code>, set <code className="type-data">HOST=0.0.0.0</code> and choose an{' '}
          <code className="type-data">APP_PASSCODE</code>.
        </li>
        <li>
          Allow the app through Windows Firewall on private networks. Run this once in PowerShell opened as Administrator:
          <div className="mt-2">
            <CopyableCode text={firewallCommand(access.port)} />
          </div>
        </li>
        <li>
          Restart the app (<code className="type-data">Ctrl+C</code>, then <code className="type-data">npm start</code>).
          Addresses for your phone will appear here.
        </li>
      </ol>
    </Section>
  )
}

const backupTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function BackupsSection() {
  const status = useSystemStatus()
  const backUp = useBackUpNow()
  const backups = status.data?.backups
  if (!backups) return null

  return (
    <Section id="backups-heading" title="Backups" description="Everything is saved to a backup file each night; the newest 14 are kept.">
      {backups.error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          The last backup didn’t work: {backups.error}
        </p>
      )}
      <p className="text-sm">
        {backups.last_at && backups.last_size !== null
          ? `Last backup: ${backupTime.format(new Date(backups.last_at))} (${formatBytes(backups.last_size)}). ${backups.count} kept.`
          : 'No backups yet. The first one runs tonight, or back up now.'}
      </p>
      <p className="mt-1 text-xs break-all text-ink-soft">
        In <code className="type-data">{backups.directory}</code>
      </p>
      <Button
        variant="outline"
        className="mt-3"
        disabled={backUp.isPending}
        onClick={() =>
          backUp.mutate(undefined, {
            onSuccess: () => toast.success('Backed up'),
            onError: (e) => toast.error(e.message),
          })
        }
      >
        {backUp.isPending ? 'Backing up…' : 'Back up now'}
      </Button>
      <p className="mt-5 text-sm">
        To go back to a backup, stop Trip Planner, then run this in the trip-planner folder. It restores the newest
        one; add a file name after <code className="type-data">--</code> to pick another.
      </p>
      <div className="mt-2">
        <CopyableCode text="npm run restore" />
      </div>
    </Section>
  )
}

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 md:px-10 md:py-12">
      <h1 className="type-title">Settings</h1>
      <TravelersSection />
      <CurrencySection />
      <OtherDevicesSection />
      <BackupsSection />
      <Section id="setup-heading" title="Setup">
        <SetupChecklist />
      </Section>
    </div>
  )
}
