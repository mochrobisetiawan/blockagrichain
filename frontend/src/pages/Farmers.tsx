import { useState } from 'react'
import { api } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast } from '../ui'

interface FarmerRow {
  id: number; fullName: string; farmerGroup: string; phone: string; farmerChainId: string
  isActive: boolean; province: string | null
}

const blank = { username: '', password: '', fullName: '', nik: '', farmerGroup: '', phone: '', village: '', district: '', city: '', province: '', landAreaHa: '' }

export default function Farmers() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, reload } = useApi<FarmerRow[]>('/farmers')
  const isKementan = user?.role === 'KEMENTAN'
  const canAdd = user?.role === 'KEMENTAN'   // hanya Kementan yang mendaftarkan petani

  const [adding, setAdding] = useState(false)
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)

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

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        <table>
          <thead><tr><th>ID On-Chain</th><th>Nama</th><th>Kelompok</th><th>Provinsi</th><th>Status</th>{isKementan && <th>Aksi</th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><Empty text="Memuat…" /></td></tr>}
            {data?.map(fr => (
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
      </div>
    </div>
  )
}
