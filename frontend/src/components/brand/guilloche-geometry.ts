/**
 * Guilloche geometry — the fine interlaced linework printed on passports and banknotes.
 * Every trip gets its own pattern, derived deterministically from a seed (the trip id),
 * so the same trip always renders the same "security print".
 */

export const ROSETTE_VIEWBOX = 200
export const BAND_VIEWBOX = { width: 800, height: 120 } as const

/** FNV-1a 32-bit hash of a string. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Small, fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TAU = Math.PI * 2
/** Inner-wheel radii for R = 96 whose curves close after 7–13 turns. */
const CENTRE_RADII = [21, 22, 26, 27, 28, 33, 39, 42, 44]
const round = (n: number) => Math.round(n * 100) / 100

function pickInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function pickFloat(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

function polylinePath(points: Array<[number, number]>, closed: boolean): string {
  const [first, ...rest] = points
  const body = rest.map(([x, y]) => `L${round(x)} ${round(y)}`).join('')
  return `M${round(first[0])} ${round(first[1])}${body}${closed ? 'Z' : ''}`
}

/**
 * A rosette: concentric bands of phase-shifted waves (the classic banknote weave)
 * around a hypotrochoid centre. Returns SVG path strings in a 200×200 viewBox.
 */
export function buildRosette(seed: string, steps = 540): string[] {
  const rng = mulberry32(hashSeed(seed))
  const c = ROSETTE_VIEWBOX / 2
  const paths: string[] = []

  const rings = pickInt(rng, 3, 4)
  const inner = pickFloat(rng, 30, 38)
  const spacing = (92 - inner) / rings

  for (let ring = 0; ring < rings; ring++) {
    const base = inner + spacing * (ring + 0.5)
    const freq = pickInt(rng, 9, 22)
    const amp = spacing * pickFloat(rng, 0.32, 0.5)
    const harmonic = pickInt(rng, 2, 5)
    const harmonicAmp = amp * pickFloat(rng, 0.1, 0.3)
    const copies = pickInt(rng, 5, 8)

    for (let k = 0; k < copies; k++) {
      const phase = (TAU * k) / copies
      const points: Array<[number, number]> = []
      for (let s = 0; s < steps; s++) {
        const t = (TAU * s) / steps
        const r = base + amp * Math.sin(freq * t + phase) + harmonicAmp * Math.sin(harmonic * freq * t - phase)
        points.push([c + r * Math.cos(t), c + r * Math.sin(t)])
      }
      paths.push(polylinePath(points, true))
    }
  }

  // Hypotrochoid centre. With integer radii the curve closes after r / gcd(R, r) turns;
  // only radii giving 7–13 turns are used so the centre is intricate but not a solid blot.
  const bigR = 96
  const smallR = CENTRE_RADII[Math.floor(rng() * CENTRE_RADII.length)]
  const d = smallR * pickFloat(rng, 0.85, 1.5)
  const scale = (inner * 0.9) / (bigR - smallR + d)
  const turns = smallR / gcd(bigR, smallR)
  const centreSteps = turns * 240
  const centre: Array<[number, number]> = []
  for (let s = 0; s < centreSteps; s++) {
    const t = (TAU * turns * s) / centreSteps
    const x = (bigR - smallR) * Math.cos(t) + d * Math.cos(((bigR - smallR) / smallR) * t)
    const y = (bigR - smallR) * Math.sin(t) - d * Math.sin(((bigR - smallR) / smallR) * t)
    centre.push([c + x * scale, c + y * scale])
  }
  paths.push(polylinePath(centre, true))

  return paths
}


/**
 * A horizontal security band: two mirrored families of phase-shifted waves that
 * cross into a woven lattice. Returns SVG path strings in an 800×120 viewBox.
 */
export function buildBand(seed: string, stepPx = 4): string[] {
  const rng = mulberry32(hashSeed(`band:${seed}`))
  const { width, height } = BAND_VIEWBOX
  const mid = height / 2
  const paths: string[] = []

  const wavelength = pickFloat(rng, 90, 170)
  const amp = pickFloat(rng, 22, 34)
  const slowWavelength = wavelength * pickFloat(rng, 3.5, 6)
  const slowAmp = pickFloat(rng, 6, 12)
  const copies = pickInt(rng, 6, 9)

  for (const direction of [1, -1]) {
    for (let k = 0; k < copies; k++) {
      const phase = (TAU * k) / copies
      const points: Array<[number, number]> = []
      for (let x = 0; x <= width; x += stepPx) {
        const y =
          mid +
          direction * amp * Math.sin((TAU * x) / wavelength + phase) +
          slowAmp * Math.sin((TAU * x) / slowWavelength + phase / 2)
        points.push([x, y])
      }
      paths.push(polylinePath(points, false))
    }
  }

  return paths
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
