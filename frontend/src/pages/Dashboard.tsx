import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { fmt, fmtRp } from '../api'
import { Badge, Empty, Stat } from '../ui'

const C = { g700: '#1a5e38', g600: '#22773f', blue: '#2563eb', amber: '#d97706', purple: '#7c3aed', red: '#dc2626' }

interface Stats {
  harvests: { total: number; pending: number; verified: number; rejected: number; totalQtyKg: number }
  allocations: { count: number; ureaKg: number; npkKg: number; organicKg: number }
  distributions: { total: number; created: number; shipped: number; delivered: number; confirmed: number }
  payments: { requested: number; disbursed: number; rejected: number; totalDisbursedIdr: number }
  budget: { capIdr: number; usedIdr: number; activePolicy: string | null }
  byProvince: { province: string; harvests: number; ureaKg: number; npkKg: number }[]
  blockHeight: number
}

const PageHead = ({ t, s }: { t: string; s: string }) => (
  <div style={{ marginBottom: 22 }}>
    <div style={{ fontSize: 22, fontWeight: 800 }}>{t}</div>
    <div style={{ fontSize: 13, color: 'var(--txtS)' }}>{s}</div>
  </div>
)
const StatRow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>{children}</div>
)
const Panel = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <div style={{ background: '#fff', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 20 }}>
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{title}</span>{right}
    </div>
    {children}
  </div>
)
const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--txtS)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{children}</th>
)
const Td = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <td style={{ padding: '12px 16px', fontSize: 13, ...style }}>{children}</td>
)

/* ───────── BULOG ───────── */
interface HRow { id: number; harvestChainId: string; cropType: string; qtyClaimedKg: number; status: string; farmer?: { fullName: string }; land?: { province: string }; allocation?: { ureaKg: number; npkKg: number; organicKg: number } | null }
function BulogDash({ s }: { s: Stats }) {
  const { data: rows } = useApi<HRow[]>('/harvests/pending')
  return (
    <div>
      <PageHead t="Dashboard Bulog" s="Verifikasi & validasi laporan panen — Hyperledger Fabric Endorser" />
      <StatRow>
        <Stat label="Menunggu Verifikasi" value={s.harvests.pending} sub="Laporan antrian" color={C.amber} icon="⏳" />
        <Stat label="Terverifikasi" value={s.harvests.verified} sub="Total" color={C.g600} icon="✔" />
        <Stat label="Ditolak" value={s.harvests.rejected} sub="Total" color={C.red} icon="✕" />
        <Stat label="Total Panen" value={fmt(s.harvests.total)} sub={`${fmt(s.harvests.totalQtyKg)} kg diklaim`} color={C.blue} icon="🌾" />
      </StatRow>
      <Panel title="Antrian Verifikasi Panen" right={<Link to="/queue" style={{ fontSize: 12, color: C.g600, fontWeight: 700 }}>Buka antrian →</Link>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}>{['ID', 'Petani', 'Tanaman', 'Klaim (kg)', 'Provinsi', 'Status'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {(rows ?? []).slice(0, 6).map(h => (
              <tr key={h.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--txtS)' }}>{h.harvestChainId}</Td>
                <Td style={{ fontWeight: 700 }}>{h.farmer?.fullName ?? '—'}</Td>
                <Td>{h.cropType}</Td>
                <Td style={{ fontWeight: 700, color: C.g700 }}>{fmt(h.qtyClaimedKg)}</Td>
                <Td style={{ color: 'var(--txtS)', fontSize: 12 }}>{h.land?.province ?? '—'}</Td>
                <Td><Badge status={h.status} /></Td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && <tr><td colSpan={6}><Empty text="Tidak ada antrian. Semua terverifikasi 🎉" /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

/* ───────── KEMENTAN ───────── */
function KementanDash({ s }: { s: Stats }) {
  const maxH = Math.max(1, ...s.byProvince.map(p => p.harvests))
  const crops = [{ l: 'Padi', v: 58, c: C.g600 }, { l: 'Jagung', v: 28, c: C.amber }, { l: 'Kedelai', v: 14, c: C.blue }]
  return (
    <div>
      <PageHead t="Dashboard Kementan" s="Monitoring nasional produktivitas & implementasi kebijakan subsidi" />
      <StatRow>
        <Stat label="Total Panen" value={fmt(s.harvests.total)} sub="Terdaftar di sistem" color={C.g700} icon="👨‍🌾" />
        <Stat label="Terverifikasi" value={fmt(s.harvests.verified)} sub={`${s.harvests.pending} menunggu`} color={C.blue} icon="✔" />
        <Stat label="Alokasi Urea" value={`${fmt(s.allocations.ureaKg)} kg`} sub="On-chain" color={C.amber} icon="🌾" />
        <Stat label="Kebijakan Aktif" value={s.budget.activePolicy ? '1' : '0'} sub={s.budget.activePolicy ?? '—'} color={C.g600} icon="⊞" />
      </StatRow>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Sebaran Panen per Provinsi (on-chain)</div>
          {s.byProvince.length === 0 ? <Empty text="Belum ada data provinsi" /> : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
              {s.byProvince.slice(0, 6).map(d => (
                <div key={d.province} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700 }}>{d.harvests}</div>
                  <div style={{ width: '100%', background: C.g600, borderRadius: '5px 5px 0 0', height: `${Math.round(d.harvests / maxH * 100)}%`, minHeight: 4 }} />
                  <div style={{ fontSize: 9, color: 'var(--txtS)', textAlign: 'center', lineHeight: 1.2 }}>{d.province}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Distribusi Tanaman</div>
          {crops.map(d => (
            <div key={d.l} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}><span style={{ fontWeight: 600 }}>{d.l}</span><span style={{ color: 'var(--txtS)' }}>{d.v}%</span></div>
              <div style={{ background: '#f3f4f6', borderRadius: 5, height: 7 }}><div style={{ height: '100%', width: `${d.v}%`, background: d.c, borderRadius: 5 }} /></div>
            </div>
          ))}
        </div>
      </div>
      <Panel title="Sebaran Distribusi per Provinsi (GIS)">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}>{['Provinsi', 'Panen', 'Urea (kg)', 'NPK (kg)'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {s.byProvince.map(p => (
              <tr key={p.province} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td style={{ fontWeight: 700 }}>{p.province}</Td><Td>{p.harvests}</Td>
                <Td style={{ color: C.g700, fontWeight: 600 }}>{fmt(p.ureaKg)}</Td>
                <Td style={{ color: C.blue, fontWeight: 600 }}>{fmt(p.npkKg)}</Td>
              </tr>
            ))}
            {s.byProvince.length === 0 && <tr><td colSpan={4}><Empty text="Belum ada data" /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

/* ───────── KEMENKEU ───────── */
interface PRow { id: number; amountIdr: number; status: string; kemenkeuRef?: string; distribution?: { distributionChainId: string; farmer: string } | null }
function KemenkeuDash({ s }: { s: Stats }) {
  const { data: pays } = useApi<PRow[]>('/payments')
  const pct = s.budget.capIdr ? (s.budget.usedIdr / s.budget.capIdr * 100) : 0
  return (
    <div>
      <PageHead t="Dashboard Kemenkeu" s="Pengelolaan anggaran subsidi pupuk & audit blockchain" />
      <StatRow>
        <Stat label="Total Anggaran" value={fmtRp(s.budget.capIdr)} sub="Budget cap" color={C.purple} icon="💰" />
        <Stat label="Sudah Dicairkan" value={fmtRp(s.budget.usedIdr)} sub={`${pct.toFixed(1)}% terserap`} color={C.g600} icon="✔" />
        <Stat label="Klaim Pending" value={s.payments.requested} sub="Menunggu approval" color={C.amber} icon="⏳" />
        <Stat label="Pencairan" value={s.payments.disbursed} sub="Total transaksi" color={C.blue} icon="💸" />
      </StatRow>
      <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', marginBottom: 20, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Realisasi Anggaran Subsidi Pupuk</div>
          <div style={{ fontSize: 12, color: 'var(--txtS)' }}>{fmtRp(s.budget.usedIdr)} / {fmtRp(s.budget.capIdr)}</div>
        </div>
        <div style={{ background: '#f3f4f6', borderRadius: 8, height: 14, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: 'linear-gradient(90deg,var(--g700),var(--g500))', borderRadius: 8, transition: 'width .8s ease' }} />
        </div>
      </div>
      <Panel title="Permintaan Pembayaran Subsidi" right={<Link to="/payments" style={{ fontSize: 12, color: C.g600, fontWeight: 700 }}>Kelola →</Link>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}>{['Order', 'Petani', 'Nominal', 'Status'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {(pays ?? []).slice(0, 6).map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--txtS)' }}>{p.distribution?.distributionChainId ?? '—'}</Td>
                <Td style={{ fontWeight: 700 }}>{p.distribution?.farmer ?? '—'}</Td>
                <Td style={{ fontWeight: 700, color: C.purple }}>{fmtRp(p.amountIdr)}</Td>
                <Td><Badge status={p.status} /></Td>
              </tr>
            ))}
            {(!pays || pays.length === 0) && <tr><td colSpan={4}><Empty text="Belum ada klaim subsidi" /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

/* ───────── PIHC ───────── */
interface DRow { id: number; distributionChainId: string; status: string; scheduledDate?: string; farmer?: { fullName: string } | null; allocation?: { ureaKg: number; npkKg: number; organicKg: number } | null }
function PihcDash({ s }: { s: Stats }) {
  const { data: ds } = useApi<DRow[]>('/distributions')
  return (
    <div>
      <PageHead t="Dashboard Pupuk Indonesia" s="Distribusi pupuk bersubsidi tepat sasaran berbasis smart contract" />
      <StatRow>
        <Stat label="Order Distribusi" value={s.distributions.total} sub="Total aktif" color={C.amber} icon="📦" />
        <Stat label="Terkirim" value={s.distributions.delivered + s.distributions.confirmed} sub="Dikonfirmasi" color={C.g600} icon="✔" />
        <Stat label="Dalam Pengiriman" value={s.distributions.shipped} sub="Sedang dikirim" color={C.blue} icon="🚚" />
        <Stat label="Urea Tersalurkan" value={`${fmt(s.allocations.ureaKg)} kg`} sub="On-chain" color={C.g700} icon="🌾" />
      </StatRow>
      <Panel title="Order Distribusi Aktif" right={<Link to="/distributions" style={{ fontSize: 12, color: C.g600, fontWeight: 700 }}>Kelola →</Link>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}>{['Order ID', 'Petani', 'Pupuk (U/N/O)', 'Jadwal', 'Status'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {(ds ?? []).slice(0, 7).map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--txtS)' }}>{d.distributionChainId}</Td>
                <Td style={{ fontWeight: 700 }}>{d.farmer?.fullName ?? '—'}</Td>
                <Td style={{ fontWeight: 600, color: C.g700 }}>{d.allocation ? `${d.allocation.ureaKg}/${d.allocation.npkKg}/${d.allocation.organicKg}` : '—'}</Td>
                <Td style={{ color: 'var(--txtS)', fontSize: 12 }}>{d.scheduledDate ?? '—'}</Td>
                <Td><Badge status={d.status} /></Td>
              </tr>
            ))}
            {(!ds || ds.length === 0) && <tr><td colSpan={5}><Empty text="Belum ada order distribusi" /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

/* ───────── FARMER (mobile) ───────── */
interface FProfile { fullName: string; farmerGroup: string; farmerChainId: string; lands: { village: string; province: string }[]; onChain: { TotalHarvests: number } | null }
interface FHarvest { id: number; cropType: string; qtyClaimedKg: number; status: string; submittedAt?: string; land?: { province: string }; allocation?: { ureaKg: number; npkKg: number; organicKg: number } | null }
function FarmerDash() {
  const nav = useNavigate()
  const { data: profile } = useApi<FProfile>('/farmers/me')
  const { data: harvests } = useApi<FHarvest[]>('/harvests')
  const latest = harvests?.find(h => h.allocation) ?? harvests?.[0]
  const a = latest?.allocation
  const quota = [{ l: 'Urea', v: a ? `${a.ureaKg} kg` : '—', c: '#86efac' }, { l: 'NPK', v: a ? `${a.npkKg} kg` : '—', c: '#93c5fd' }, { l: 'Organik', v: a ? `${a.organicKg} kg` : '—', c: '#fcd34d' }]
  const actions = [{ ico: '📋', l: 'Input Panen', to: '/submit' }, { ico: '📊', l: 'Status', to: '/harvests' }, { ico: '🚚', l: 'Distribusi', to: '/distributions' }, { ico: '🔍', l: 'Cek Hash', to: '/verify-hash' }]
  return (
    <div className="fade">
      <div style={{ background: 'linear-gradient(150deg,var(--g700),var(--g500))', padding: '18px 18px 26px' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginBottom: 2 }}>Selamat datang 👋</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{profile?.fullName ?? 'Petani'}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>{profile?.lands[0]?.village ?? ''}{profile?.lands[0] ? ', ' : ''}{profile?.lands[0]?.province ?? ''} · {profile?.farmerChainId}</div>
        <div style={{ background: 'rgba(255,255,255,.11)', borderRadius: 14, padding: '14px 16px', marginTop: 14 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Kuota Pupuk Aktif</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
            {quota.map(q => <div key={q.l}><div style={{ fontSize: 14, fontWeight: 800, color: q.c }}>{q.v}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>{q.l}</div></div>)}
          </div>
        </div>
      </div>
      <div style={{ padding: '14px 14px 4px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Aksi Cepat</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {actions.map(act => (
            <button key={act.l} onClick={() => nav(act.to)} style={{ padding: '13px 8px', borderRadius: 14, border: '1px solid var(--border)', background: '#fff', textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
              <div style={{ fontSize: 22, marginBottom: 5 }}>{act.ico}</div>{act.l}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Riwayat Terbaru</div>
        {(harvests ?? []).slice(0, 4).map(h => (
          <div key={h.id} style={{ background: '#fff', borderRadius: 12, padding: '11px 13px', marginBottom: 7, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{h.cropType} · {fmt(h.qtyClaimedKg)} kg</div>
              <div style={{ fontSize: 10, color: 'var(--txtS)', marginTop: 2 }}>{(h.submittedAt ?? '').slice(0, 10)} · {h.land?.province ?? ''}</div>
            </div>
            <Badge status={h.status} />
          </div>
        ))}
        {(!harvests || harvests.length === 0) && <Empty text="Belum ada laporan. Mulai dari Input Panen." />}
      </div>
    </div>
  )
}

/* ───────── ROOT ───────── */
function GovWrap({ render }: { render: (s: Stats) => React.ReactNode }) {
  const { data, loading } = useApi<Stats>('/dashboard/stats')
  if (loading || !data) return <Empty text="Memuat statistik…" />
  return <>{render(data)}</>
}

export default function Dashboard() {
  const { user } = useAuth()
  if (!user) return null
  if (user.role === 'FARMER') return <FarmerDash />
  if (user.role === 'BULOG') return <GovWrap render={s => <BulogDash s={s} />} />
  if (user.role === 'KEMENTAN') return <GovWrap render={s => <KementanDash s={s} />} />
  if (user.role === 'KEMENKEU') return <GovWrap render={s => <KemenkeuDash s={s} />} />
  return <GovWrap render={s => <PihcDash s={s} />} />
}
