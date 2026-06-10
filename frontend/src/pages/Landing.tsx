import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RegionMap, { type RegionPoint } from '../components/RegionMap'

interface Net {
  fabricUp: boolean; blockHeight: number; nodesOnline: number; nodesTotal: number
  nodes: { name: string; online: boolean }[]
  regions?: RegionPoint[]
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: up ? '#a7f3d0' : '#fca5a5', fontWeight: 600 }}>
            <span style={dot(!!up)} />{err ? 'Server tak terhubung' : up ? 'Jaringan aktif' : 'Jaringan down'}
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button onClick={() => nav('/login')} style={{ background: '#fff', color: '#0c2b1a', border: 'none', borderRadius: 13, padding: '15px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,.28)' }}>Masuk ke Sistem →</button>
            <button onClick={() => nav('/login?register=1')} style={{ background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.4)', borderRadius: 13, padding: '15px 26px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>🌾 Daftar sebagai Petani</button>
          </div>
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

      {/* Band statistik nyata */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.18)' }}>
        <div className="lp-stats" style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
          {[
            { l: 'Petani Terdaftar', v: net ? fmt(net.stats.farmers) : '—' },
            { l: 'Total Panen', v: net ? fmt(net.stats.harvests) : '—' },
            { l: 'Panen Terverifikasi', v: net ? fmt(net.stats.verified) : '—' },
            { l: 'Tinggi Blok', v: net ? '#' + fmt(net.blockHeight) : '—' },
          ].map(s => (
            <div key={s.l} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#86efac', fontFamily: 'monospace' }}>{s.v}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', fontWeight: 600, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section terang: Cara Kerja + Fitur + Peran */}
      <div style={{ background: '#f6faf8', color: '#0c2b1a' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '74px 24px' }}>

          {/* Peta Sebaran per Wilayah */}
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: '#1a5e38', textTransform: 'uppercase' }}>Dashboard Saluran</div>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -.8, margin: '8px 0 0' }}>Sebaran petani per wilayah</h2>
            <p style={{ color: '#5b7a68', fontSize: 14, margin: '8px 0 0' }}>Ringkasan lokasi lahan terdaftar — ukuran lingkaran menunjukkan jumlah petani.</p>
          </div>
          <div style={{ margin: '24px 0 8px' }}>
            <RegionMap points={net?.regions ?? []} height={400} />
          </div>
          {(net?.regions?.length ?? 0) === 0 && (
            <div style={{ textAlign: 'center', color: '#5b7a68', fontSize: 13, marginBottom: 40 }}>Belum ada data lokasi lahan untuk dipetakan.</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', margin: '8px 0 64px' }}>
            {(net?.regions ?? []).slice(0, 8).map(r => (
              <span key={r.province} style={{ background: '#fff', border: '1px solid #e3eee8', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#1a5e38' }}>
                {r.province} · {r.farmers}
              </span>
            ))}
          </div>

          {/* Cara Kerja */}
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: '#1a5e38', textTransform: 'uppercase' }}>Alur Sistem</div>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -.8, margin: '8px 0 0' }}>Dari panen sampai pencairan subsidi</h2>
          </div>
          <div className="lp-flow" style={{ display: 'flex', alignItems: 'stretch', gap: 0, margin: '34px 0 12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { i: '🌾', t: 'Lapor Panen', d: 'Petani' }, { i: '⚖️', t: 'Verifikasi + IoT', d: 'Bulog' },
              { i: '🧮', t: 'Alokasi Otomatis', d: 'On-chain' }, { i: '🚚', t: 'Distribusi', d: 'PIHC' },
              { i: '📦', t: 'Diterima', d: 'Petani' }, { i: '🧾', t: 'Klaim Subsidi', d: 'PIHC' },
              { i: '💰', t: 'Pencairan', d: 'Kemenkeu' },
            ].map((s, i, arr) => (
              <div key={s.t} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 110, textAlign: 'center', padding: '0 4px' }}>
                  <div style={{ width: 54, height: 54, margin: '0 auto', borderRadius: 15, background: '#fff', border: '1px solid #d6e6dc', display: 'grid', placeItems: 'center', fontSize: 24, boxShadow: '0 6px 16px rgba(26,94,56,.08)' }}>{s.i}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 9 }}>{s.t}</div>
                  <div style={{ fontSize: 10.5, color: '#5b7a68', fontWeight: 600 }}>{s.d}</div>
                </div>
                {i < arr.length - 1 && <div style={{ width: 22, height: 2, background: '#bcd6c6' }} className="lp-flow-arrow" />}
              </div>
            ))}
          </div>

          {/* Fitur Utama */}
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -.6, textAlign: 'center', margin: '64px 0 6px' }}>Kenapa BlockAgriChain?</h2>
          <p style={{ textAlign: 'center', color: '#5b7a68', fontSize: 15, margin: '0 0 34px' }}>Transparansi & akuntabilitas penyaluran pupuk bersubsidi di atas blockchain.</p>
          <div className="lp-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
            {[
              { i: '🔗', t: 'Ledger Immutable', d: 'Setiap transaksi tercatat permanen di Hyperledger Fabric — tidak dapat diubah atau dihapus.' },
              { i: '⚖️', t: 'IoT Smart Scale', d: 'Berat panen dibaca otomatis dari timbangan ESP32-CAM lalu OCR di server, mengurangi kecurangan.' },
              { i: '🔒', t: 'Privasi Off-Chain', d: 'Data pribadi & foto disimpan di SQL Server / Amazon S3; hanya hash SHA-256 yang masuk ledger.' },
              { i: '🏛️', t: 'Multi-Instansi', d: '5 organisasi (Petani, Bulog, Kementan, Kemenkeu, PIHC) dengan identitas X.509 terpisah.' },
              { i: '📜', t: 'Kebijakan Transparan', d: 'Formula subsidi diusulkan Kementan & disetujui Kemenkeu, lalu berlaku otomatis di chaincode.' },
              { i: '🛡️', t: 'Audit & Integritas', d: 'Auditor dapat memverifikasi keutuhan rantai blok kapan saja melalui Audit Trail.' },
            ].map(f => (
              <div key={f.t} style={{ background: '#fff', borderRadius: 16, padding: '22px 20px', border: '1px solid #e3eee8' }}>
                <div style={{ fontSize: 26 }}>{f.i}</div>
                <div style={{ fontSize: 16, fontWeight: 800, margin: '10px 0 6px' }}>{f.t}</div>
                <div style={{ fontSize: 13.5, color: '#52715f', lineHeight: 1.6 }}>{f.d}</div>
              </div>
            ))}
          </div>

          {/* Peran dalam Jaringan */}
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -.6, textAlign: 'center', margin: '64px 0 34px' }}>Peran dalam Jaringan</h2>
          <div className="lp-roles" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14 }}>
            {[
              { i: '👨‍🌾', t: 'Petani', d: 'Lapor panen & terima pupuk' },
              { i: '🏬', t: 'Bulog', d: 'Verifikasi fisik panen (IoT)' },
              { i: '🌾', t: 'Kementan', d: 'Formula subsidi & data petani' },
              { i: '💰', t: 'Kemenkeu', d: 'Setujui anggaran & pencairan' },
              { i: '🚚', t: 'PIHC', d: 'Distribusi pupuk ke petani' },
            ].map(rl => (
              <div key={rl.t} style={{ background: '#fff', borderRadius: 14, padding: '18px 14px', border: '1px solid #e3eee8', textAlign: 'center' }}>
                <div style={{ fontSize: 28 }}>{rl.i}</div>
                <div style={{ fontSize: 14.5, fontWeight: 800, margin: '8px 0 4px' }}>{rl.t}</div>
                <div style={{ fontSize: 11.5, color: '#52715f', lineHeight: 1.5 }}>{rl.d}</div>
              </div>
            ))}
          </div>

          {/* CTA bawah */}
          <div style={{ textAlign: 'center', marginTop: 56, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => nav('/login')} style={{ background: 'linear-gradient(150deg,#2d9b5f,#1a5e38)', color: '#fff', border: 'none', borderRadius: 13, padding: '15px 30px', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 28px rgba(26,94,56,.25)' }}>Masuk ke Sistem →</button>
            <button onClick={() => nav('/login?register=1')} style={{ background: '#fff', color: '#1a5e38', border: '1.5px solid #1a5e38', borderRadius: 13, padding: '15px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>🌾 Daftar sebagai Petani</button>
          </div>
        </div>
      </div>

      {/* Tech pills + footer */}
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '46px 24px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Hyperledger Fabric', 'X.509 MSP', 'CouchDB', 'IoT ESP32-CAM', 'SHA-256', 'SQL Server', 'Amazon S3'].map(t => (
          <span key={t} style={{ background: 'rgba(255,255,255,.08)', borderRadius: 20, padding: '6px 15px', fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{t}</span>
        ))}
      </div>
      <div style={{ textAlign: 'center', padding: '14px 24px 40px', fontSize: 12, color: 'rgba(255,255,255,.4)' }}>
        © 2026 BlockAgriChain · Blockchain Penyaluran Pupuk Bersubsidi
      </div>

      <style>{`
        @media(max-width:820px){
          .lp-grid{grid-template-columns:1fr!important;gap:36px!important;padding-top:40px!important}
          .lp-stats{grid-template-columns:1fr 1fr!important;gap:26px!important}
          .lp-cards{grid-template-columns:1fr!important}
          .lp-roles{grid-template-columns:1fr 1fr!important}
          .lp-flow-arrow{display:none!important}
        }
      `}</style>
    </div>
  )
}
