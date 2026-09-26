import { LngLatBounds, MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre looks for its worker next to its own module, which a bundle moves; point it at Vite's build.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef } from 'react'
import { useIsDark } from '@/lib/hooks'
import { cn } from '@/lib/utils'

setWorkerUrl(workerUrl)

// OpenFreeMap: free vector tiles, no key. The styles carry their own attribution.
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

export type MapPin = { id: string; lat: number; lon: number; label: string; title: string; color: string }
type LatLon = { lat: number; lon: number }

type Props = {
  center: LatLon
  pins: MapPin[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** Called after the person pans or zooms the map (not after the map moves itself). */
  onMoved?: (center: LatLon) => void
  className?: string
}

export default function PlaceMap({ center, pins, selectedId = null, onSelect, onMoved, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef(new Map<string, Marker>())
  const handlers = useRef({ onSelect, onMoved })
  handlers.current = { onSelect, onMoved }
  const dark = useIsDark()
  const initial = useRef({ center, dark })

  useEffect(() => {
    const { center: start, dark: startDark } = initial.current
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: startDark ? STYLES.dark : STYLES.light,
      center: [start.lon, start.lat],
      zoom: 13,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', (event) => {
      if (!event.originalEvent) return
      const c = map.getCenter()
      handlers.current.onMoved?.({ lat: c.lat, lon: c.lng })
    })
    mapRef.current = map
    const markers = markersRef.current
    return () => {
      markers.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    mapRef.current?.setStyle(dark ? STYLES.dark : STYLES.light)
  }, [dark])

  // Keep one marker per pin, updating label, color, and selection in place.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = markersRef.current
    for (const [id, marker] of markers) {
      if (!pins.some((p) => p.id === id)) {
        marker.remove()
        markers.delete(id)
      }
    }
    for (const pin of pins) {
      let marker = markers.get(pin.id)
      if (marker === undefined) {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'tp-map-pin'
        const shape = document.createElement('span')
        shape.appendChild(document.createElement('span'))
        el.appendChild(shape)
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          handlers.current.onSelect?.(pin.id)
        })
        marker = new Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([pin.lon, pin.lat]).addTo(map)
        markers.set(pin.id, marker)
      }
      const el = marker.getElement()
      el.style.setProperty('--pin-color', pin.color)
      el.setAttribute('aria-label', pin.title)
      el.dataset.selected = String(pin.id === selectedId)
      el.firstElementChild!.firstElementChild!.textContent = pin.label
      marker.setLngLat([pin.lon, pin.lat])
    }
  }, [pins, selectedId])

  // Frame the pins whenever the set of results changes. The map's size can still be settling (a
  // dialog opening), so frame again once it has loaded and whenever its box changes size.
  const pinKey = pins.map((p) => p.id).join('|')
  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return
    const frame = () => {
      map.resize()
      if (pins.length === 0) {
        map.jumpTo({ center: [center.lon, center.lat] })
        return
      }
      const bounds = new LngLatBounds()
      pins.forEach((p) => bounds.extend([p.lon, p.lat]))
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 })
    }
    frame()
    if (!map.loaded()) map.once('load', frame)
    const observer = new ResizeObserver(frame)
    observer.observe(container)
    // Stop re-framing once the person starts exploring the map (the map's own moves don't count).
    const stop = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) observer.disconnect()
    }
    map.on('dragstart', stop)
    map.on('zoomstart', stop)
    return () => {
      observer.disconnect()
      map.off('load', frame)
      map.off('dragstart', stop)
      map.off('zoomstart', stop)
    }
    // Only re-frame when the results change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey])

  // Bring the selected pin into view if it's off screen.
  useEffect(() => {
    const map = mapRef.current
    const pin = pins.find((p) => p.id === selectedId)
    if (!map || !pin) return
    if (!map.getBounds().contains([pin.lon, pin.lat])) map.easeTo({ center: [pin.lon, pin.lat], duration: 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  return <div ref={containerRef} className={cn('min-h-48 overflow-hidden rounded-xl border', className)} />
}
