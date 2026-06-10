import { useEffect, useRef } from 'react'

// Peta sebaran (read-only) — plot lingkaran per wilayah, ukuran ∝ jumlah petani.
// Leaflet via CDN (tanpa npm install). Tidak meng-augmentasi global Window.L
// (sudah dideklarasikan di MapPicker) — akses lewat cast lokal agar tak bentrok.
export interface RegionPoint { province: string; farmers: number; lat: number; lng: number }

type LCircle = { addTo: (m: LMap) => LCircle; bindPopup: (s: string) => LCircle; remove: () => void }
type LMap = { setView: (c: [number, number], z?: number) => LMap; remove: () => void }
type LType = {
  map: (el: HTMLElement, opts?: Record<string, unknown>) => LMap
  tileLayer: (url: string, opts: Record<string, unknown>) => { addTo: (m: LMap) => void }
  circleMarker: (latlng: [number, number], opts: Record<string, unknown>) => LCircle
}
const getL = (): LType | undefined => (window as unknown as { L?: LType }).L

let loader: Promise<void> | null = null
function loadLeaflet(): Promise<void> {
  if (getL()) return Promise.resolve()
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

export default function RegionMap({ points, height = 380 }: { points: RegionPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<LMap | null>(null)
  const markers = useRef<LCircle[]>([])

  useEffect(() => {
    let dead = false
    loadLeaflet().then(() => {
      const L = getL()
      if (dead || !L || !ref.current) return
      if (!map.current) {
        const m = L.map(ref.current, { scrollWheelZoom: false }).setView([-2.5, 118], 4) // Indonesia
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m)
        map.current = m
      }
      markers.current.forEach(mk => mk.remove())
      markers.current = []
      const max = Math.max(1, ...points.map(p => p.farmers))
      for (const p of points) {
        if (p.lat == null || p.lng == null) continue
        const r = 8 + Math.round((p.farmers / max) * 22)
        const mk = L.circleMarker([p.lat, p.lng], { radius: r, color: '#1a5e38', weight: 2, fillColor: '#2d9b5f', fillOpacity: 0.55 })
          .addTo(map.current!)
          .bindPopup(`<b>${p.province}</b><br/>${p.farmers} petani`)
        markers.current.push(mk)
      }
    }).catch(() => {})
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)])

  return <div ref={ref} style={{ height, borderRadius: 14, overflow: 'hidden', border: '1px solid #e3eee8' }} />
}
