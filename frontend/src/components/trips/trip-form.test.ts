import { describe, expect, it } from 'vitest'
import { emptyTripInput, validateTrip, withDestinations } from './trip-form'

const kyoto = { name: 'Kyoto', lat: 35.01, lon: 135.77 }

describe('trip form rules', () => {
  it('needs a name', () => {
    expect(validateTrip({ ...emptyTripInput('USD'), name: '   ' })).toBe('Give the trip a name.')
  })

  it('accepts no dates, or both in order', () => {
    const base = { ...emptyTripInput('USD'), name: 'Japan' }
    expect(validateTrip(base)).toBeNull()
    expect(validateTrip({ ...base, start_date: '2026-11-05', end_date: '2026-11-05' })).toBeNull()
    expect(validateTrip({ ...base, start_date: '2026-11-05' })).toMatch(/both a start and an end date/)
    expect(validateTrip({ ...base, start_date: '2026-11-15', end_date: '2026-11-05' })).toMatch(/on or after/)
  })

  it('names an unnamed trip after its first destination, but never renames', () => {
    expect(withDestinations(emptyTripInput('USD'), [kyoto]).name).toBe('Kyoto')
    expect(withDestinations({ ...emptyTripInput('USD'), name: 'Honeymoon' }, [kyoto]).name).toBe('Honeymoon')
  })
})
