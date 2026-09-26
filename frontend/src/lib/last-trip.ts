/** Remember the last trip opened on this device so its sections stay one click away. */
const KEY = 'tp-last-trip'

export function readLastTripId(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY))
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function rememberTrip(tripId: number): void {
  try {
    localStorage.setItem(KEY, String(tripId))
  } catch {
    // Storage unavailable; the switcher simply won't preselect a trip.
  }
}
