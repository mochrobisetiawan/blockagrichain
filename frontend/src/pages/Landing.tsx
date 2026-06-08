import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Net {
  fabricUp: boolean; blockHeight: number; nodesOnline: number; nodesTotal: number
  nodes: { name: string; online: boolean }[]
  stats: { farmers: number; harvests: number; verified: number; activePolicies: number }
}

const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

// Landing page — data NYATA dari /api/public/network (status node, tinggi blok, statistik).
// Saat node offline → titik merah & badge berubah. Refresh tiap 12 detik.
export default function Landing() {
  const nav = useNavigate()
  const [net, setNet] = useState<Net | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/public/network')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (alive) { setNet(d); setErr(false) } })
      .catch(() => { if (alive) setErr(true) })
    load()
    const t = setInterval(load, 12000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const up = net?.fabricUp && (net?.nodesOnline ?? 0) > 0
  const dot = (on: boolean) => ({ width: 9, height: 9, borderRadius: '50%', background: on ? '#86efac' : '#f87171', boxShadow: on ? '0 0 0 3px rgba(134,239,172,.2)' : '0 0 0 3px rgba(248,113,113,.2)', flexShrink: 0 })

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(120% 90% at 80% -10%, #1d6b40 0%, #0c2b1a 55%, #081c12 100%)', color: '#fff' }}>
      {/* Top nav */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(8,28,18,.92)', backdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 24px', height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: 'linear-gradient(150deg,#2d9b5f,#1a5e38)', borderRadius: 9, display: 'grid', placeItems: 'center', boxShadow: '0 6px 16px rgba(26,94,56,.35)' }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v10l9 5 9-5V7L12 2z" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" /><path d="M12 7v10M3 7l9 5 9-5" stroke="#fff" strokeWidth="1.5" /></svg>
            </div>
            <div><div style={{ fontWeight: 800, fontSize: 17, letterSpacing: -.4 }}>BlockAgriChain</div><div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: .3, fontWeight: 600 }}>Blockchain Pupuk Bersubsidi</div></div>
          </div>
          <button onClick={() => nav('/login')} style={{ background: '#fff', color: '#0c2b1a', border: 'none', borderRadius: 11, padding: '10px 20px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>Masuk ke Sistem</button>
        </div>
      </div>

      {/* Hero */}
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '64px 24px 90px', display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: 56, alignItems: 'center' }} className="lp-grid">
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'rgba(134,239,172,.12)', border: '1px solid rgba(134,239,172,.25)', borderRadius: 30, padding: '7px 15px', marginBottom: 26 }}>
            <span style={dot(!!up)} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: up ? '#a7f3d0' : '#fca5a5' }}>
              {err ? 'Tidak terhubung ke server' : up ? `Jaringan Aktif · ${net?.nodesOnline}/${net?.nodesTotal} node online` : 'Jaringan Down · periksa node'}
            </span>
          </div>
          <h1 style={{ fontSize: 'clamp(34px,3.9vw,52px)', fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.2, margin: '0 0 22px', maxWidth: 540, textWrap: 'balance' }}>
            Subsidi pupuk yang <span style={{ color: '#86efac' }}>transparan</span>, dari panen hingga pencairan.
          </h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,.62)', lineHeight: 1.65, maxWidth: 480, margin: '0 0 34px' }}>
            BlockAgriChain mencatat setiap langkah penyaluran pupuk bersubsidi — laporan petani, verifikasi Bulog, alokasi Kementan, distribusi, hingga pencairan Kemenkeu — di atas ledger blockchain yang tak dapat diubah.
          </p>
          <button onClick={() => nav('/login')} style={{ background: '#fff', color: '#0c2b1a', border: 'none', borderRadius: 13, padding: '15px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,.28)' }}>Masuk ke Sistem →</button>
        </div>

        {/* Live ledger card — DATA NYATA */}
        <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 22, padding: 18, backdropFilter: 'blur(10px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, padding: '0 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: 1 }}>Live Ledger</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: up ? '#86efac' : '#fca5a5', fontWeight: 700 }}>
              <span style={dot(!!up)} />{net ? `${net.nodesOnline}/${net.nodesTotal} Node Online` : '…'}
            </div>
          </div>

          {/* Nodes status nyata */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {(net?.nodes ?? Array.from({ length: 6 }, () => ({ name: '—', online: false }))).map((n, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.05)', borderRadius: 9, padding: '8px 11px' }}>
                <span style={dot(n.online)} />
                <span style={{ fontSize: 11.5, color: n.online ? '#fff' : 'rgba(255,255,255,.5)', fontWeight: 600 }}>{n.name}</span>
              </div>
            ))}
          </div>

          {/* Metrik nyata */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { l: 'Block Height', v: net ? '#' + fmt(net.blockHeight) : '—', c: '#fcd34d' },
              { l: 'Petani Terdaftar', v: net ? fmt(net.stats.farmers) : '—', c: '#86efac' },
              { l: 'Panen Terverifikasi', v: net ? fmt(net.stats.verified) : '—', c: '#93c5fd' },
              { l: 'Kebijakan Aktif', v: net ? fmt(net.stats.activePolicies) : '—', c: '#fff' },
            ].map(m => (
              <div key={m.l} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 11, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: .4, fontWeight: 700 }}>{m.l}</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: m.c, fontFamily: 'monospace', marginTop: 3 }}>{m.v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', textAlign: 'center', marginTop: 12 }}>Diperbarui otomatis dari ledger · tiap 12 detik</div>
        </div>
      </div>

      {/* Tech pills */}
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 24px 60px', display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Hyperledger Fabric', 'X.509 MSP', 'CouchDB', 'IoT ESP32-CAM', 'SHA-256', 'SQL Server', 'Amazon S3'].map(t => (
          <span key={t} style={{ background: 'rgba(255,255,255,.08)', borderRadius: 20, padding: '6px 15px', fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{t}</span>
        ))}
      </div>

      <style>{`@media(max-width:820px){.lp-grid{grid-template-columns:1fr!important;gap:36px!important;padding-top:40px!important}}`}</style>
    </div>
  )
}
