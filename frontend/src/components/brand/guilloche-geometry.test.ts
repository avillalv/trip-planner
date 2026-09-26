import { describe, expect, it } from 'vitest'
import { buildBand, buildRosette, hashSeed } from './guilloche-geometry'

const PATH_RE = /^M-?[\d.]+ -?[\d.]+(L-?[\d.]+ -?[\d.]+)+Z?$/

describe('guilloche geometry', () => {
  it('is deterministic for a seed, so a trip always keeps its pattern', () => {
    expect(buildRosette('trip-123')).toEqual(buildRosette('trip-123'))
    expect(buildBand('trip-123')).toEqual(buildBand('trip-123'))
  })

  it('gives different trips different patterns', () => {
    expect(buildRosette('trip-a')).not.toEqual(buildRosette('trip-b'))
    expect(hashSeed('trip-a')).not.toBe(hashSeed('trip-b'))
  })

  it('produces closed, finite rosette paths', () => {
    const paths = buildRosette('check-me')
    expect(paths.length).toBeGreaterThan(10)
    for (const d of paths) {
      expect(d).toMatch(PATH_RE)
      expect(d.endsWith('Z')).toBe(true)
    }
  })

  it('produces two mirrored wave families for bands', () => {
    const paths = buildBand('band-check')
    expect(paths.length % 2).toBe(0)
    expect(paths.length).toBeGreaterThanOrEqual(12)
    for (const d of paths) expect(d).toMatch(PATH_RE)
  })
})
