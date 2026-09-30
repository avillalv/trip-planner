import { describe, expect, it } from 'vitest'
import { lodging } from '@/test/fixtures'
import { aiPickNotes, airbnbSearchUrl, byAiRank } from './lodging-meta'

describe('airbnbSearchUrl', () => {
  it('puts the place in the path and the dates and guests in the query', () => {
    expect(airbnbSearchUrl({ place: 'Kyoto', checkIn: '2026-11-09', checkOut: '2026-11-12', guests: 2 })).toBe(
      'https://www.airbnb.com/s/Kyoto/homes?checkin=2026-11-09&checkout=2026-11-12&adults=2',
    )
  })

  it('escapes spaces, commas, slashes and accents in the place', () => {
    const url = airbnbSearchUrl({ place: ' São Miguel, Açores / Azores ', checkIn: '2026-11-09', checkOut: '2026-11-12', guests: 4 })
    expect(url).toBe(
      'https://www.airbnb.com/s/S%C3%A3o%20Miguel%2C%20A%C3%A7ores%20%2F%20Azores/homes?checkin=2026-11-09&checkout=2026-11-12&adults=4',
    )
  })

  it('leaves out what is not filled in yet', () => {
    expect(airbnbSearchUrl({ place: '', checkIn: '', checkOut: '', guests: 3 })).toBe('https://www.airbnb.com/s/homes?adults=3')
  })
})

describe('aiPickNotes', () => {
  it('splits the rank from the reason', () => {
    expect(aiPickNotes('AI pick #2: Quiet street, 5 min to the beach.')).toEqual({
      rank: 2,
      text: 'Quiet street, 5 min to the beach.',
    })
  })

  it('leaves your own notes alone', () => {
    expect(aiPickNotes('Sam liked the garden')).toEqual({ rank: null, text: 'Sam liked the garden' })
    expect(aiPickNotes('See AI pick #2: later')).toEqual({ rank: null, text: 'See AI pick #2: later' })
  })
})

describe('byAiRank', () => {
  it('orders by rank, then by when they were saved, with unranked last', () => {
    const pick = (id: number, notes: string, created: string) => lodging({ id, notes, created_at: `2026-09-29T${created}Z` })
    const list = [
      pick(1, 'AI pick #3: c', '12:00:01'),
      pick(2, 'no rank, saved second', '12:00:03'),
      pick(3, 'AI pick #1: a', '12:00:02'),
      pick(4, 'no rank, saved first', '12:00:00'),
      pick(5, 'AI pick #10: j', '12:00:04'),
    ]
    expect([...list].sort(byAiRank).map((o) => o.id)).toEqual([3, 1, 5, 4, 2])
  })
})
