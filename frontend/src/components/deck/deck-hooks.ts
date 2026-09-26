import { useCallback, useEffect, useState } from 'react'

/** True after `ms` without the pointer moving (the controls fade out while presenting). */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), ms)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), ms)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [ms])
  return idle
}

/** Enter full screen from a click or key press; browsers refuse it otherwise, and some phones never allow it. */
export function enterFullscreen() {
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}

export function useFullscreen() {
  const [on, setOn] = useState(() => Boolean(document.fullscreenElement))
  useEffect(() => {
    const onChange = () => setOn(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggle = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else enterFullscreen()
  }, [])
  return { on, toggle, supported: Boolean(document.fullscreenEnabled) }
}

/** Print on light paper even in dark mode (dark pages waste ink, and most printers drop backgrounds). */
export function usePrintInLight() {
  useEffect(() => {
    const root = document.documentElement
    let wasDark = false
    const before = () => {
      wasDark = root.classList.contains('dark')
      root.classList.remove('dark')
    }
    const after = () => {
      if (wasDark) root.classList.add('dark')
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
      after()
    }
  }, [])
}
