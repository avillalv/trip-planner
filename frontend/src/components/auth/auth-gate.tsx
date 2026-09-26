import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { sessionKey, useSession } from '@/lib/api/auth'
import { onUnauthorized } from '@/lib/api/client'
import { LoginScreen } from './login-screen'

/** Shows the passcode screen to other devices until they sign in; this PC passes straight through. */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession()
  const queryClient = useQueryClient()

  // If a session expires mid-use, any 401 re-checks the session and brings back the passcode screen.
  useEffect(
    () => onUnauthorized(() => void queryClient.invalidateQueries({ queryKey: sessionKey })),
    [queryClient],
  )

  if (session.isPending) return null
  if (session.data && !session.data.authenticated) {
    return <LoginScreen passcodeConfigured={session.data.passcode_configured} />
  }
  // If the session check itself fails (server down), let the app render its own error states.
  return children
}
