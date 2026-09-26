import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { Providers } from '@/app/providers'
import { router } from '@/app/router'
import { AuthGate } from '@/components/auth/auth-gate'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </Providers>
  </StrictMode>,
)
