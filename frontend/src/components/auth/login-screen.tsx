import { useState, type FormEvent } from 'react'
import { Guilloche } from '@/components/brand/guilloche'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLogin } from '@/lib/api/auth'

/** Shown on phones and other computers until the passcode is entered. */
export function LoginScreen({ passcodeConfigured }: { passcodeConfigured: boolean }) {
  const login = useLogin()
  const [passcode, setPasscode] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (passcode) login.mutate(passcode, { onError: () => setPasscode('') })
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <Guilloche seed="passcode" animate className="mx-auto size-40" />
        <h1 className="type-title mt-6">Trip Planner</h1>
        {passcodeConfigured ? (
          <form onSubmit={submit} className="mt-4 space-y-3 text-left">
            <p className="text-center text-ink-soft">Enter the passcode to open Trip Planner on this device.</p>
            <Label htmlFor="passcode" className="sr-only">
              Passcode
            </Label>
            <Input
              id="passcode"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="h-11 text-center text-lg"
            />
            {login.error && (
              <p role="alert" className="text-center text-sm text-destructive">
                {login.error.message}
              </p>
            )}
            <Button type="submit" className="h-11 w-full" disabled={!passcode || login.isPending}>
              {login.isPending ? 'Checking…' : 'Unlock'}
            </Button>
          </form>
        ) : (
          <p className="mt-4 text-ink-soft">
            Access from other devices is turned off. On the computer running Trip Planner, set APP_PASSCODE in .env
            and restart the app.
          </p>
        )}
      </div>
    </main>
  )
}
