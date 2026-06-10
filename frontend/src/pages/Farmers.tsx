import { useState } from 'react'
import { api } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast } from '../ui'

interface FarmerRow {
  id: number; fullName: string; farmerGroup: string; phone: string; farmerChainId: string
  isActive: boolean; province: string | null
}
interface PendingRow {
  id: number; fullName: string; username: string; farmerGroup?: string; phone?: string
  province?: string; city?: string; landAreaHa?: number
}

const blank = { username: '', password: '', fullName: '', nik: '', farmerGroup: '', phone: '', village: '', district: '', city: '', province: '', landAreaHa: '' }

export default function Farmers() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, reload } = useApi<FarmerRow[]>('/farmers')
  const isKementan = user?.role === 'KEMENTAN'
  const canAdd = user?.role === 'KEMENTAN'   // hanya Kementan yang mendaftarkan petani
  const { data: pending, reload: reloadPending } = useApi<PendingRow[]>(isKementan ? '/farmers/pending' : null)

  const [adding, setAdding] = useState(false)
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const PER = 8
  const total = data?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PER))
  const paged = (data ?? []).slice(page * PER, page * PER + PER)

  const approve = async (id: number) => {
    try { await api.post(`/farmers/${id}/approve`); toast('Petani disetujui & terdaftar on-chain'); reload(); reloadPending() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }

  const disable = async (id: number) => {
    if (!confirm('Nonaktifkan akun petani ini? (soft-delete on-chain)')) return
    try { await api.post(`/farmers/${id}/disable`); toast('Petani dinonaktifkan on-chain'); reload() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const res = await api.post<{ username: string; farmerChainId: string }>('/farmers', {
        username: f.username, password: f.password, fullName: f.fullName, nik: f.nik, farmerGroup: f.farmerGroup, phone: f.phone,
        village: f.village, district: f.district, city: f.city, province: f.province, landAreaHa: Number(f.landAreaHa) || 0,
      })
      toast(`Petani ${res.username} terdaftar on-chain (${res.farmerChainId})`)
      setF(blank); setAdding(false); reload()
    } catch (ex) { toast((ex as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="fade">
      <div className="between">
        <div>
          <h1 className="page-title">Data Petani</h1>
          <p className="page-sub">Identitas on-chain (fabric_client_id) · NIK asli tidak ditampilkan (privasi)</p>
        </div>
        {canAdd && !adding && <button className="btn" onClick={() => setAdding(true)}>+ Tambah Petani</button>}
      </div>

      {adding && (
        <form className="card" style={{ marginTop: 16 }} onSubmit={create}>
          <h3>Daftarkan Petani Baru</h3>
          <div className="grid cols-3">
            <div className="field"><label>Username</label><input value={f.username} onChange={e => setF({ ...f, username: e.target.value })} required placeholder="mis. sari" /></div>
            <div className="field"><label>Password Awal</label><input type="text" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required placeholder="kata sandi awal petani" /></div>
            <div className="field"><label>Nama Lengkap</label><input value={f.fullName} onChange={e => setF({ ...f, fullName: e.target.value })} required /></div>
            <div className="field"><label>NIK (16 digit)</label><input value={f.nik} onChange={e => setF({ ...f, nik: e.target.value })} required maxLength={16} placeholder="hanya disimpan sebagai hash" /></div>
            <div className="field"><label>Kelompok Tani</label><input value={f.farmerGroup} onChange={e => setF({ ...f, farmerGroup: e.target.value })} /></div>
            <div className="field"><label>No. Telepon</label><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
            <div className="field"><label>Luas Lahan (ha)</label><input type="number" step="0.01" value={f.landAreaHa} onChange={e => setF({ ...f, landAreaHa: e.target.value })} /></div>
            <div className="field"><label>Desa/Kelurahan</label><input value={f.village} onChange={e => setF({ ...f, village: e.target.value })} /></div>
            <div className="field"><label>Kecamatan</label><input value={f.district} onChange={e => setF({ ...f, district: e.target.value })} /></div>
            <div className="field"><label>Kota/Kabupaten</label><input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} /></div>
            <div className="field"><label>Provinsi</label><input value={f.province} onChange={e => setF({ ...f, province: e.target.value })} /></div>
          </div>
          <div className="row">
            <button className="btn" disabled={busy}>{busy ? 'Mendaftarkan on-chain…' : '👨‍🌾 Daftarkan Petani'}</button>
            <button type="button" className="btn secondary" onClick={() => setAdding(false)}>Batal</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Petani dapat mengganti kata sandi sendiri di menu Profil. NIK hanya disimpan sebagai SHA-256 di ledger.</p>
        </form>
      )}

      {isKementan && (pending?.length ?? 0) > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: '#fcd34d', background: '#fffbeb' }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10, color: '#92400e' }}>⏳ Pendaftaran Menunggu Persetujuan ({pending?.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending?.map(pr => (
              <div key={pr.id} style={{ background: '#fff', borderRadius: 10, padding: '11px 14px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{pr.fullName} <span className="muted" style={{ fontWeight: 400 }}>@{pr.username}</span></div>
                  <div className="muted" style={{ fontSize: 11 }}>{[pr.city, pr.province].filter(Boolean).join(', ') || '—'} · {pr.landAreaHa ?? 0} ha · {pr.farmerGroup ?? '—'}{pr.phone ? ` · ${pr.phone}` : ''}</div>
                </div>
                <button className="btn sm" style={{ background: '#1a5e38', color: '#fff' }} onClick={() => approve(pr.id)}>✓ Setujui & Daftarkan On-Chain</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        <table>
          <thead><tr><th>ID On-Chain</th><th>Nama</th><th>Kelompok</th><th>Provinsi</th><th>Status</th>{isKementan && <th>Aksi</th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><Empty text="Memuat…" /></td></tr>}
            {!loading && total === 0 && <tr><td colSpan={6}><Empty text="Belum ada petani" /></td></tr>}
            {paged.map(fr => (
              <tr key={fr.id}>
                <td className="mono">{fr.farmerChainId}</td>
                <td>{fr.fullName}</td>
                <td>{fr.farmerGroup}</td>
                <td>{fr.province ?? '—'}</td>
                <td><Badge status={fr.isActive ? 'ACTIVE' : 'SUPERSEDED'} /></td>
                {isKementan && <td>{fr.isActive && <button className="btn sm danger" onClick={() => disable(fr.id)}>Nonaktifkan</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {total > PER && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span className="muted" style={{ fontSize: 12 }}>Menampilkan {page * PER + 1}–{Math.min((page + 1) * PER, total)} dari {total}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn sm secondary" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Sebelumnya</button>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{page + 1}/{pageCount}</span>
              <button className="btn sm secondary" disabled={page >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Berikutnya →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
