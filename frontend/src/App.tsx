import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'
import type { Role } from './api'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import SubmitHarvest from './pages/SubmitHarvest'
import Harvests from './pages/Harvests'
import Policies from './pages/Policies'
import Payments from './pages/Payments'
import Distributions from './pages/Distributions'
import Explorer from './pages/Explorer'
import Notifications from './pages/Notifications'
import VerifyHash from './pages/VerifyHash'
import Farmers from './pages/Farmers'
import Profil from './pages/Profil'
import Demo from './pages/Demo'

interface NavDef { to: string; label: string; icon: string }

const NAV: Record<Role, NavDef[]> = {
  FARMER: [
    { to: '/', label: 'Beranda', icon: '⌂' },
    { to: '/submit', label: 'Input', icon: '+' },
    { to: '/harvests', label: 'Status', icon: '○' },
    { to: '/distributions', label: 'Kirim', icon: '◇' },
    { to: '/profil', label: 'Profil', icon: '☺' },
  ],
  BULOG: [
    { to: '/', label: 'Dashboard', icon: '◈' },
    { to: '/queue', label: 'Verifikasi Panen', icon: '✔' },
    { to: '/farmers', label: 'Data Petani', icon: '≡' },
    { to: '/notifications', label: 'Notifikasi', icon: '◔' },
    { to: '/explorer', label: 'Blockchain Explorer', icon: '⛓' },
  ],
  KEMENTAN: [
    { to: '/', label: 'Dashboard', icon: '◈' },
    { to: '/policies', label: 'Kelola Kebijakan', icon: '⊞' },
    { to: '/demo', label: 'Demo Chaincode', icon: '⚗' },
    { to: '/farmers', label: 'Data Petani', icon: '≡' },
    { to: '/explorer', label: 'Blockchain Explorer', icon: '⛓' },
  ],
  KEMENKEU: [
    { to: '/', label: 'Dashboard', icon: '◈' },
    { to: '/payments', label: 'Pembayaran Subsidi', icon: '◇' },
    { to: '/policies', label: 'Persetujuan Kebijakan', icon: '⊞' },
    { to: '/explorer', label: 'Audit Trail', icon: '≡' },
  ],
  PIHC: [
    { to: '/', label: 'Dashboard', icon: '◈' },
    { to: '/distributions', label: 'Distribusi Pupuk', icon: '↗' },
    { to: '/payments', label: 'Klaim Subsidi', icon: '◇' },
    { to: '/explorer', label: 'Blockchain Explorer', icon: '⛓' },
  ],
}

const ROLE_LABEL: Record<Role, string> = {
  FARMER: 'Petani', BULOG: 'Petugas Bulog', KEMENTAN: 'Kementerian Pertanian',
  KEMENKEU: 'Kementerian Keuangan', PIHC: 'Pupuk Indonesia',
}

function LogoMark({ sz = 24, dark = false }: { sz?: number; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ width: sz, height: sz, background: 'var(--g600)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width={sz * 0.58} height={sz * 0.58} viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M12 7v10M3 7l9 5 9-5" stroke="#fff" strokeWidth="1.5" />
        </svg>
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: sz * 0.52, color: dark ? '#fff' : 'var(--g700)', lineHeight: 1.1, letterSpacing: -0.3 }}>BlockAgriChain</div>
        <div style={{ fontSize: sz * 0.27, color: dark ? 'rgba(255,255,255,.5)' : 'var(--txtS)', lineHeight: 1.1 }}>Blockchain Pupuk Bersubsidi</div>
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/submit" element={<SubmitHarvest />} />
      <Route path="/harvests" element={<Harvests />} />
      <Route path="/queue" element={<Harvests />} />
      <Route path="/verify-hash" element={<VerifyHash />} />
      <Route path="/policies" element={<Policies />} />
      <Route path="/payments" element={<Payments />} />
      <Route path="/distributions" element={<Distributions />} />
      <Route path="/farmers" element={<Farmers />} />
      <Route path="/profil" element={<Profil />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/explorer" element={<Explorer />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}

/* ───────── Desktop shell (Bulog, Kementan, Kemenkeu, PIHC) ───────── */
function DesktopShell() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  if (!user) return null
  const items = NAV[user.role]
  const current = items.find(i => i.to === loc.pathname)?.label ?? 'Dashboard'

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: 'var(--g900)', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
        <div style={{ padding: '22px 18px 12px' }}><LogoMark sz={24} dark /></div>
        <div style={{ margin: '0 12px 16px', padding: '10px 14px', background: 'rgba(255,255,255,.07)', borderRadius: 10 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Login sebagai</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{ROLE_LABEL[user.role]}</div>
          <div style={{ fontSize: 11, color: '#86efac', marginTop: 2 }}>● Terautentikasi · {user.mspId}</div>
        </div>
        <nav style={{ flex: 1, padding: '4px 10px', overflowY: 'auto' }}>
          {items.map(it => (
            <NavLink key={it.to} to={it.to} end={it.to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', borderRadius: 10, marginBottom: 3,
                background: isActive ? 'rgba(255,255,255,.13)' : 'transparent',
                color: isActive ? '#fff' : 'rgba(255,255,255,.55)', fontSize: 13, fontWeight: isActive ? 700 : 400,
                textAlign: 'left', transition: 'all .18s', textDecoration: 'none',
              })}>
              <span style={{ fontSize: 14, width: 16, textAlign: 'center' }}>{it.icon}</span>{it.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '14px 12px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <button onClick={() => { logout(); nav('/') }} style={{ width: '100%', padding: '9px', borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: 12, fontWeight: 600 }}>
            ← Keluar (@{user.username})
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', background: '#f7fdf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '13px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>{current}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--g700)', background: '#f0faf5', padding: '4px 10px', borderRadius: 20, border: '1px solid var(--g200)' }}>● Terhubung · Fabric</div>
            <div style={{ fontSize: 11, color: 'var(--txtS)' }}>@{user.username}</div>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--g100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--g700)' }}>{user.username[0]?.toUpperCase()}</div>
          </div>
        </div>
        <div className="fade" style={{ padding: 28 }}>
          <AppRoutes />
        </div>
      </div>
    </div>
  )
}

/* ───────── Mobile shell (Petani) ───────── */
function MobileShell() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  if (!user) return null
  const items = NAV[user.role]
  return (
    <div className="mob-wrap" style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#e6f4ec,#f0faf5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 390 }}>
        <div className="mob-phone" style={{ background: '#18181b', borderRadius: 46, padding: '14px 10px 10px', boxShadow: '0 32px 80px rgba(0,0,0,.45)' }}>
          <div className="mob-notch" style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
            <div style={{ width: 110, height: 26, background: '#000', borderRadius: 20 }} />
          </div>
          <div className="mob-screen" style={{ background: '#f0faf5', borderRadius: 36, overflow: 'hidden', minHeight: 700, display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: 'var(--g700)', padding: '8px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,.9)', fontSize: 12, fontWeight: 700 }}>09:41</span>
              <LogoMark sz={16} dark />
              <span style={{ color: 'rgba(255,255,255,.8)', fontSize: 11, fontWeight: 600 }}>4G ●●●</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }} className="fade fmob">
              <AppRoutes />
            </div>
            <div style={{ background: '#fff', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: `repeat(${items.length},1fr)` }}>
              {items.map(t => (
                <NavLink key={t.to} to={t.to} end={t.to === '/'}
                  style={({ isActive }) => ({
                    padding: '9px 4px 10px', textDecoration: 'none',
                    color: isActive ? 'var(--g600)' : 'var(--txtS)', fontSize: 10, fontWeight: isActive ? 700 : 400,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  })}>
                  <span style={{ fontSize: t.icon === '+' ? 22 : 17, lineHeight: 1 }}>{t.icon}</span>{t.label}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="mob-home" style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
            <div style={{ width: 90, height: 4, background: 'rgba(255,255,255,.25)', borderRadius: 4 }} />
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button onClick={() => { logout(); nav('/') }} style={{ fontSize: 12, color: 'var(--g700)', fontWeight: 600, background: 'rgba(255,255,255,.7)', border: '1px solid var(--g200)', padding: '7px 20px', borderRadius: 20, cursor: 'pointer' }}>← Keluar</button>
        </div>
      </div>
    </div>
  )
}

function PublicApp() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Memuat…</div>
  if (!user) return <PublicApp />
  return user.role === 'FARMER' ? <MobileShell /> : <DesktopShell />
}
