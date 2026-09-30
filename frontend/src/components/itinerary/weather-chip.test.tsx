import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DayWeather } from '@/lib/api/weather'
import { WeatherChip } from './weather-chip'

function weather(overrides: Partial<DayWeather> = {}): DayWeather {
  return {
    day: '2026-11-05',
    destination_id: 1,
    destination_name: 'Kyoto',
    kind: 'forecast',
    high_f: 84,
    low_f: 72,
    precip_in: 0.12,
    rain_chance: 40,
    wet_days_pct: null,
    ...overrides,
  }
}

describe('WeatherChip', () => {
  it('shows a forecast with its chance of rain', () => {
    render(<WeatherChip weather={weather()} />)

    const text = screen.getByText('84° / 72° · 40% rain')
    expect(text.closest('[title]')).toHaveAttribute('title', 'Forecast: 84°F high, 72°F low, 40% chance of rain')
    expect(screen.queryByText('typical')).not.toBeInTheDocument()
  })

  it('marks typical weather and explains where it comes from', () => {
    render(<WeatherChip weather={weather({ kind: 'typical', rain_chance: null, wet_days_pct: 43 })} />)

    const text = screen.getByText('84° / 72° · 43% wet days')
    expect(text.closest('[title]')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Typical for this date: average of the last 5 years\./),
    )
    expect(screen.getByText('typical')).toBeInTheDocument()
  })

  it('leaves out the rain part when the forecast has no chance', () => {
    render(<WeatherChip weather={weather({ rain_chance: null })} />)

    expect(screen.getByText('84° / 72°')).toBeInTheDocument()
  })
})
