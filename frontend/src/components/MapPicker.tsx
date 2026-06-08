import { useEffect, useRef } from 'react'

// Peta pemilih titik GPS (Leaflet via CDN — tanpa npm install).
// Marker bisa digeser & klik peta untuk memindah titik. onChange(lat,lng).
type LType = {
  map: (el: HTMLElement) => LMap
  tileLayer: (url: string, opts: Record<string, unknown>) => { addTo: (m: LMap) => void }
  marker: (latlng: [number, number], opts: Record<string, unknown>) => LMarker
}
type LMap = { setView: (c: [number, number], z?: number) => LMap; on: (ev: string, cb: (e: { latlng: { lat: number; lng: number } }) => void) => void; remove: () => void }
type LMarker = { addTo: (m: LMap) => LMarker; on: (ev: string, cb: () => void) => void; getLatLng: () => { lat: number; lng: number }; setLatLng: (c: [number, number]) => void }
declare global { interface Window { L?: LType } }

let loader: Promise<void> | null = null
function loadLeaflet(): Promise<void> {
  if (window.L) return Promise.resolve()
  if (loader) return loader
  loader = new Promise<void>((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => resolve()
    js.onerror = () => reject(new Error('gagal memuat peta'))
    document.head.appendChild(js)
  })
  return loader
}

export default function MapPicker({ lat, lng, onChange, height = 240 }:
  { lat: number; lng: number; onChange: (lat: number, lng: number) => void; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<LMap | null>(null)
  const marker = useRef<LMarker | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    let dead = false
    loadLeaflet().then(() => {
      const L = window.L
      if (dead || !L || !ref.current || map.current) return
      const m = L.map(ref.current).setView([lat, lng], 15)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m)
      const mk = L.marker([lat, lng], { draggable: true }).addTo(m)
      mk.on('dragend', () => { const p = mk.getLatLng(); cb.current(p.lat, p.lng) })
      m.on('click', (e) => { mk.setLatLng([e.latlng.lat, e.latlng.lng]); cb.current(e.latlng.lat, e.latlng.lng) })
      map.current = m; marker.current = mk
    }).catch(() => {})
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (marker.current && map.current) { marker.current.setLatLng([lat, lng]); map.current.setView([lat, lng]) }
  }, [lat, lng])

  return <div ref={ref} style={{ height, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }} />
}
