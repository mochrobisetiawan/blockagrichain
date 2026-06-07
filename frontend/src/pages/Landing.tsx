import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

// Landing = prototype "BlockAgriChain" asli (file yang disetor ke dosen),
// ditampilkan apa adanya via iframe agar 100% identik. Tombol "Masuk ke Sistem"
// / "Login" dicegat dan dialihkan ke halaman login aplikasi nyata.
export default function Landing() {
  const nav = useNavigate()
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) return
        doc.addEventListener('click', (e) => {
          const el = (e.target as HTMLElement | null)?.closest('button,a')
          if (!el) return
          const t = (el.textContent || '').toLowerCase()
          if (t.includes('masuk ke sistem') || t.includes('masuk') || t.includes('login')) {
            e.preventDefault()
            e.stopPropagation()
            nav('/login')
          }
        }, true) // capture phase: cegat sebelum React prototype menanganinya
      } catch {
        /* cross-origin tidak mungkin terjadi (same-origin) */
      }
    }
    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [nav])

  return (
    <iframe
      ref={ref}
      src="/landing-prototype.html"
      title="BlockAgriChain — Beranda"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
