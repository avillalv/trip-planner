import { CloudRain, CloudSun, Sun } from 'lucide-react'
import type { DayWeather } from '@/lib/api/weather'
import { cn } from '@/lib/utils'

function Icon({ weather }: { weather: DayWeather }) {
  const chance = (weather.kind === 'forecast' ? weather.rain_chance : weather.wet_days_pct) ?? 0
  const Glyph = chance >= 45 ? CloudRain : chance >= 20 ? CloudSun : Sun
  return <Glyph className="size-3.5 shrink-0" aria-hidden="true" />
}

/** A day's high and low with how likely rain is: the forecast, or (marked "typical") the last five years' average. */
export function WeatherChip({ weather, className }: { weather: DayWeather; className?: string }) {
  const forecast = weather.kind === 'forecast'
  const chance = forecast ? weather.rain_chance : weather.wet_days_pct
  const temps = `${weather.high_f}°F high, ${weather.low_f}°F low`
  const rain = forecast ? `${chance}% chance of rain` : `rain or snow on ${chance}% of days`
  const where = weather.whole_country
    ? ` Measured at the middle of ${weather.destination_name}; regions differ a lot. Set the day's place for local weather.`
    : ''
  const title = forecast
    ? `Forecast: ${temps}${chance === null ? '' : `, ${rain}`}.${where}`
    : `Typical for this date: average of the last 5 years. ${temps}${chance === null ? '' : `, ${rain}`}.${where}`
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 text-xs text-ink-soft', className)}>
      <Icon weather={weather} />
      <span className="sr-only">{forecast ? 'Forecast: ' : 'Typical weather: '}</span>
      <span className="type-data">
        {weather.high_f}° / {weather.low_f}°
        {chance !== null && ` · ${chance}% ${forecast ? 'rain' : 'wet days'}`}
      </span>
      {!forecast && <span className="type-label text-[0.625rem]">typical</span>}
    </span>
  )
}

/** Open-Meteo's data is CC BY 4.0: show this once wherever weather appears. */
export function WeatherAttribution({ className }: { className?: string }) {
  return (
    <a
      href="https://open-meteo.com/"
      target="_blank"
      rel="noreferrer"
      className={cn('text-xs text-ink-soft underline underline-offset-2', className)}
    >
      Weather data by Open-Meteo.com
    </a>
  )
}
