import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { systemStatus } from '@/test/fixtures'
import { mockApi, renderWithProviders } from '@/test/render'
import { OtherDevicesSection } from './settings-page'

describe('OtherDevicesSection', () => {
  it('shows the Tailscale link to send once this computer is shared', async () => {
    const access = { other_devices: false, passcode_configured: true, port: 8000, urls: [], tailscale_urls: ['https://tonys-pc.tail1234.ts.net'] }
    mockApi({ '/api/v1/system/status': systemStatus({ access }) })

    renderWithProviders(<OtherDevicesSection />)

    expect(await screen.findByText('https://tonys-pc.tail1234.ts.net')).toBeInTheDocument()
    expect(screen.getByText(/can open Trip Planner from anywhere/)).toBeInTheDocument()
    expect(screen.queryByText(/Allow the app through Windows Firewall/)).not.toBeInTheDocument()
  })

  it('says how to share when only this computer can open it', async () => {
    mockApi({ '/api/v1/system/status': systemStatus() })

    renderWithProviders(<OtherDevicesSection />)

    expect(await screen.findByText('Only this computer can open Trip Planner right now.')).toBeInTheDocument()
    expect(screen.getByText('npm run share')).toBeInTheDocument()
  })
})
