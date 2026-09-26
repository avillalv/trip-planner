import { parseDate } from '@/lib/dates'

export type LatLon = { lat: number; lon: number }
export type XY = { x: number; y: number }

/**
 * Places points in a width × height box (equirectangular, scaled by latitude so distances look
 * right), centered, with `margin` kept clear. A single point sits in the middle.
 */
export function projectPoints(points: LatLon[], width: number, height: number, margin: number): XY[] {
  if (points.length === 0) return []
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const squeeze = Math.cos((meanLat * Math.PI) / 180)
  const xs = points.map((p) => p.lon * squeeze)
  const ys = points.map((p) => -p.lat)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const spanX = maxX - minX
  const spanY = maxY - minY
  const scale = Math.min(
    spanX > 0 ? (width - 2 * margin) / spanX : Infinity,
    spanY > 0 ? (height - 2 * margin) / spanY : Infinity,
  )
  const k = Number.isFinite(scale) ? scale : 0
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return points.map((_, i) => ({ x: width / 2 + (xs[i] - cx) * k, y: height / 2 + (ys[i] - cy) * k }))
}

/** A chart's size and the plot area's margins inside it (room for labels). */
export type ChartBox = { width: number; height: number; left: number; right: number; top: number; bottom: number }

/**
 * Positions a daily price series in a chart's plot area. `extra` values (a typical range) widen
 * the vertical scale so they stay in view; returns the points and the price → y mapping.
 */
export function scaleSeries(
  points: Array<{ day: string; price: number }>,
  box: ChartBox,
  extra: number[] = [],
): { coords: XY[]; y: (price: number) => number } {
  const times = points.map((p) => parseDate(p.day).getTime())
  const [t0, t1] = [Math.min(...times), Math.max(...times)]
  const values = [...points.map((p) => p.price), ...extra]
  let low = Math.min(...values)
  let high = Math.max(...values)
  if (low === high) {
    low -= 1
    high += 1
  }
  const pad = (high - low) * 0.08
  low -= pad
  high += pad
  const plotWidth = box.width - box.left - box.right
  const plotHeight = box.height - box.top - box.bottom
  const x = (t: number) => (t1 === t0 ? box.left + plotWidth / 2 : box.left + ((t - t0) / (t1 - t0)) * plotWidth)
  const y = (price: number) => box.top + (1 - (price - low) / (high - low)) * plotHeight
  return { coords: points.map((p, i) => ({ x: x(times[i]), y: y(p.price) })), y }
}
