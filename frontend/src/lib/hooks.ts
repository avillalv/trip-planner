import { useEffect, useState, useSyncExternalStore } from 'react'

/** The value, updated only after it stops changing for `delay` ms (for search-as-you-type). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Re-render every `intervalMs` so clocks and countdowns stay current. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function subscribeToDarkMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** Whether the page shows in dark mode right now (from the theme toggle or the system setting). */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribeToDarkMode,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
}
