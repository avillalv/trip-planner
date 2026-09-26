import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { LoginScreen } from './login-screen'

describe('LoginScreen', () => {
  it('shows the server message for a wrong passcode and clears the field', async () => {
    const fetch = mockApi({
      'POST /api/auth/login': () => jsonResponse({ detail: 'Wrong passcode. Try again.' }, 401),
    })
    renderWithProviders(<LoginScreen passcodeConfigured />)

    await userEvent.type(screen.getByLabelText('Passcode'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode. Try again.')
    expect(screen.getByLabelText('Passcode')).toHaveValue('')
    const sent = fetch.mock.calls[0][0] as Request
    expect(sent.headers.get('X-Trip-Planner')).toBe('1')
  })

  it('explains how to turn on access when no passcode is configured', () => {
    renderWithProviders(<LoginScreen passcodeConfigured={false} />)

    expect(screen.getByText(/set APP_PASSCODE in .env/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Passcode')).not.toBeInTheDocument()
  })
})
