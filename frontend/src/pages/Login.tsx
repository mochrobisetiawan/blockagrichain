import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../api'
import MapPicker from '../components/MapPicker'

const regBlank = { username: '', password: '', fullName: '', nik: '', phone: '', farmerGroup: '', village: '', district: '', city: '', province: '', landAreaHa: '' }

// Definisi field form registrasi + aturan validasi per-input.
const REG_FIELDS: { k: string; label: string; type: string; req?: boolean; hint?: string; valid: (v: string) => boolean }[] = [
  { k: 'username', label: 'Username', type: 'text', req: true, hint: 'min. 3 karakter', valid: v => v.trim().length >= 3 },
  { k: 'password', label: 'Kata Sandi', type: 'password', req: true, hint: 'min. 6 karakter', valid: v => v.length >= 6 },
  { k: 'fullName', label: 'Nama Lengkap', type: 'text', req: true, hint: 'min. 3 karakter', valid: v => v.trim().length >= 3 },
  { k: 'nik', label: 'NIK', type: 'text', req: true, hint: 'tepat 16 angka', valid: v => /^\d{16}$/.test(v) },
  { k: 'phone', label: 'No. Telepon', type: 'text', hint: '8–15 angka', valid: v => v === '' || /^\d{8,15}$/.test(v) },
  { k: 'farmerGroup', label: 'Kelompok Tani', type: 'text', valid: () => true },
  { k: 'village', label: 'Desa/Kelurahan', type: 'text', valid: () => true },
  { k: 'district', label: 'Kecamatan', type: 'text', valid: () => true },
  { k: 'city', label: 'Kota/Kabupaten', type: 'text', valid: () => true },
  { k: 'province', label: 'Provinsi', type: 'text', valid: () => true },
  { k: 'landAreaHa', label: 'Luas Lahan (ha)', type: 'number', hint: 'angka > 0', valid: v => v === '' || Number(v) > 0 },
]

const ROLES = [
  { id: 'PETANI', l: 'Petani', d: 'Input data panen & lihat kuota pupuk subsidi', icon: '🌾', c: '#16a34a', user: 'budi' },
  { id: 'BULOG', l: 'Bulog', d: 'Verifikasi fisik panen & validasi ke blockchain', icon: '⚖️', c: '#0891b2', user: 'bulog' },
  { id: 'KEMENTAN', l: 'Kementan', d: 'Monitoring nasional & kelola kebijakan subsidi', icon: '🏛️', c: '#2563eb', user: 'kementan' },
  { id: 'KEMENKEU', l: 'Kemenkeu', d: 'Anggaran, pencairan & audit keuangan blockchain', icon: '💰', c: '#7c3aed', user: 'kemenkeu' },
  { id: 'PIHC', l: 'Pupuk Indonesia', d: 'Distribusi tepat sasaran ke petani terverifikasi', icon: '🏭', c: '#d97706', user: 'pihc' },
]
const NET = [
  { l: 'Node Validator', v: '3/3 Online', c: '#86efac' },
  { l: 'Fabric Network', v: 'Active', c: '#86efac' },
  { l: 'Smart Contract', v: 'v2.1.4', c: '#93c5fd' },
  { l: 'Block Height', v: '#14,521', c: '#fcd34d' },
]

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [sel, setSel] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('password123')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [params] = useSearchParams()
  const [mode, setMode] = useState<'login' | 'register'>(params.get('register') ? 'register' : 'login')
  const [reg, setReg] = useState(regBlank)
  const [regGps, setRegGps] = useState({ lat: -6.2, lng: 106.816 })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [regBusy, setRegBusy] = useState(false)
  const [regErr, setRegErr] = useState('')
  const [regDone, setRegDone] = useState(false)
  const allValid = REG_FIELDS.every(f => (f.req ? (reg as Record<string, string>)[f.k].trim() !== '' : true) && f.valid((reg as Record<string, string>)[f.k]))

  const doRegister = async (e: React.FormEvent) => {
    e.preventDefault(); setRegBusy(true); setRegErr('')
    try {
      await api.post('/auth/register', { ...reg, landAreaHa: Number(reg.landAreaHa) || 0, gpsLat: regGps.lat, gpsLng: regGps.lng })
      setRegDone(true); setReg(regBlank)
    } catch (ex) { setRegErr((ex as Error).message) } finally { setRegBusy(false) }
  }

  const pick = (id: string, user: string) => { setSel(id); setUsername(user); setErr('') }

  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sel) return
    setBusy(true); setErr('')
    try { await login(username, password) }
    catch (ex) { setErr((ex as Error).message) }
    finally { setBusy(false) }
  }

  const selRole = ROLES.find(r => r.id === sel)

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(150deg,#0c2b1a 0%,#1a5e38 55%,#2d9b5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="fade" style={{ width: '100%', maxWidth: 860 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ width: 52, height: 52, background: 'rgba(255,255,255,.14)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
                <path d="M12 7v10M3 7l9 5 9-5" stroke="#fff" strokeWidth="1.5" />
              </svg>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>BlockAgriChain</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>Sistem Blockchain Alokasi Pupuk Bersubsidi</div>
            </div>
          </div>
          <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 13, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            Platform berbasis Hyperledger Fabric untuk transparansi distribusi pupuk subsidi — dari input panen petani hingga pencairan Kemenkeu.
          </p>
        </div>

        {/* Tab Masuk / Daftar */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 18 }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setRegDone(false); setRegErr('') }} style={{
              padding: '8px 20px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${mode === m ? '#fff' : 'rgba(255,255,255,.2)'}`,
              background: mode === m ? '#fff' : 'transparent', color: mode === m ? 'var(--g700)' : 'rgba(255,255,255,.7)',
            }}>{m === 'login' ? 'Masuk' : 'Daftar sebagai Petani'}</button>
          ))}
        </div>

        {mode === 'register' ? (
          regDone ? (
            <div className="fade" style={{ maxWidth: 460, margin: '0 auto 18px', background: 'rgba(255,255,255,.07)', borderRadius: 16, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Pendaftaran terkirim</div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)', lineHeight: 1.6 }}>Akun Anda menunggu <b>persetujuan Kementan</b>. Setelah disetujui (dan terdaftar on-chain), Anda dapat masuk.</div>
              <button onClick={() => setMode('login')} style={{ marginTop: 16, padding: '10px 22px', borderRadius: 11, border: 'none', background: '#fff', color: 'var(--g700)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Ke Halaman Masuk</button>
            </div>
          ) : (
            <form onSubmit={doRegister} className="fade" style={{ maxWidth: 580, margin: '0 auto 18px', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>🌾 Daftar sebagai Petani</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginBottom: 16 }}>Lengkapi data; akun aktif setelah disetujui Kementan. Tanda <span style={{ color: '#fca5a5' }}>*</span> wajib.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {REG_FIELDS.map(f => {
                  const val = (reg as Record<string, string>)[f.k]
                  const empty = val.trim() === ''
                  const showErr = touched[f.k] && ((f.req && empty) || !f.valid(val))
                  const showOk = !empty && f.valid(val)
                  const border = showErr ? '#fca5a5' : showOk ? '#86efac' : 'rgba(255,255,255,.2)'
                  return (
                    <div key={f.k}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.72)', display: 'block', marginBottom: 4 }}>
                        {f.label} {f.req && <span style={{ color: '#fca5a5' }}>*</span>}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input type={f.type} value={val}
                          inputMode={f.k === 'nik' || f.k === 'phone' ? 'numeric' : f.type === 'number' ? 'decimal' : undefined}
                          onChange={e => setReg({ ...reg, [f.k]: e.target.value })}
                          onBlur={() => setTouched(t => ({ ...t, [f.k]: true }))}
                          style={{ width: '100%', padding: '10px 28px 10px 12px', borderRadius: 10, border: `1.5px solid ${border}`, background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 13, outline: 'none' }} />
                        {showOk && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#86efac', fontSize: 12 }}>✓</span>}
                        {showErr && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#fca5a5', fontSize: 12 }}>✕</span>}
                      </div>
                      {(showErr || f.hint) && (
                        <div style={{ fontSize: 10, marginTop: 3, color: showErr ? '#fca5a5' : 'rgba(255,255,255,.4)' }}>
                          {showErr ? (empty ? 'Wajib diisi' : `Format tidak valid${f.hint ? ` (${f.hint})` : ''}`) : f.hint}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.72)', display: 'block', marginBottom: 6 }}>📍 Titik Lokasi Lahan (geser pin / klik peta)</label>
                <MapPicker lat={regGps.lat} lng={regGps.lng} onChange={(la, ln) => setRegGps({ lat: la, lng: ln })} height={200} />
                <div className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>{regGps.lat.toFixed(5)}, {regGps.lng.toFixed(5)}</div>
              </div>
              {regErr && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 12, background: 'rgba(220,38,38,.15)', padding: '8px 12px', borderRadius: 8 }}>{regErr}</div>}
              <button disabled={regBusy || !allValid} style={{ width: '100%', marginTop: 16, padding: '13px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700, cursor: regBusy || !allValid ? 'not-allowed' : 'pointer', background: allValid ? '#fff' : 'rgba(255,255,255,.35)', color: 'var(--g700)', opacity: allValid ? 1 : .8 }}>
                {regBusy ? 'Mengirim pendaftaran…' : allValid ? 'Daftar — Menunggu Persetujuan Kementan' : 'Lengkapi data wajib (*)'}
              </button>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 10, textAlign: 'center' }}>NIK hanya disimpan sebagai hash SHA-256 di ledger.</div>
            </form>
          )
        ) : (<>
        {/* Role cards */}
        <div className="role-grid">
          {ROLES.map(r => (
            <button key={r.id} onClick={() => pick(r.id, r.user)} style={{
              padding: '20px 12px', borderRadius: 16, cursor: 'pointer', textAlign: 'center', transition: 'all .2s',
              border: `2px solid ${sel === r.id ? r.c : 'rgba(255,255,255,.1)'}`,
              background: sel === r.id ? r.c + '25' : 'rgba(255,255,255,.05)',
            }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>{r.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 6 }}>{r.l}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', lineHeight: 1.5 }}>{r.d}</div>
            </button>
          ))}
        </div>

        {/* Network status */}
        <div style={{ background: 'rgba(255,255,255,.07)', borderRadius: 12, padding: '10px 18px', display: 'flex', gap: 20, alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
          {NET.map(x => (
            <div key={x.l} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 8, color: x.c }}>●</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>{x.l}:</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: x.c }}>{x.v}</span>
            </div>
          ))}
        </div>

        {/* Credential form (muncul saat peran dipilih) */}
        {sel && (
          <form onSubmit={go} className="fade" style={{ maxWidth: 420, margin: '0 auto', background: 'rgba(255,255,255,.07)', borderRadius: 16, padding: 22, marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>● Masuk sebagai {selRole?.l}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 16, fontFamily: 'monospace' }}>org: {sel.toLowerCase()}.blockagri.id</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.7)', display: 'block', marginBottom: 5 }}>Nama Pengguna / NIK</label>
              <input value={username} onChange={e => setUsername(e.target.value)} autoFocus placeholder="NIK / ID"
                style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1.5px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 13 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.7)', display: 'block', marginBottom: 5 }}>Kata Sandi</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1.5px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 13 }} />
            </div>
            {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 12 }}>{err}</div>}
            <button disabled={busy} style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: '#fff', color: 'var(--g700)' }}>
              {busy ? 'Mengautentikasi…' : `Masuk sebagai ${selRole?.l}`}
            </button>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 10, textAlign: 'center' }}>Demo password: <b style={{ color: 'rgba(255,255,255,.7)' }}>password123</b></div>
          </form>
        )}
        </>)}

        <div style={{ textAlign: 'center' }}>
          <button onClick={() => nav('/')} style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', fontWeight: 600, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', padding: '8px 22px', borderRadius: 20, cursor: 'pointer' }}>← Kembali ke Beranda</button>
        </div>
      </div>
    </div>
  )
}
