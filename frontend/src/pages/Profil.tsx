import { useState } from 'react'
import { api } from '../api'
import { useApi } from '../hooks'
import { Empty, useToast } from '../ui'
import MapPicker from '../components/MapPicker'

interface Land { id: number; village: string; district: string; city?: string; province: string; landAreaHa: number; gpsLat?: number; gpsLng?: number; isPrimary: boolean }
interface Profile { fullName: string; farmerGroup?: string; phone?: string; farmerChainId: string; lands: Land[] }

export default function Profil() {
  const { data, loading, reload } = useApi<Profile>('/farmers/me')
  const toast = useToast()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fullName: '', farmerGroup: '', phone: '' })
  const [busy, setBusy] = useState(false)

  const [adding, setAdding] = useState(false)
  const [land, setLand] = useState({ village: '', district: '', city: '', province: '', landAreaHa: '' })
  const [gps, setGps] = useState({ lat: -6.2, lng: 106.816 })

  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState({ old: '', neu: '' })
  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await api.patch('/farmers/me/password', { oldPassword: pw.old, newPassword: pw.neu })
      toast('Kata sandi diperbarui'); setPwOpen(false); setPw({ old: '', neu: '' })
    } catch (ex) { toast((ex as Error).message, 'error') } finally { setBusy(false) }
  }

  const openEdit = () => {
    setForm({ fullName: data?.fullName ?? '', farmerGroup: data?.farmerGroup ?? '', phone: data?.phone ?? '' })
    setEditing(true)
  }
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { await api.patch('/farmers/me', form); toast('Profil diperbarui'); setEditing(false); reload() }
    catch (ex) { toast((ex as Error).message, 'error') } finally { setBusy(false) }
  }
  const saveLand = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await api.post('/farmers/me/lands', {
        village: land.village, district: land.district, city: land.city, province: land.province,
        landAreaHa: Number(land.landAreaHa), gpsLat: gps.lat, gpsLng: gps.lng, isPrimary: (data?.lands.length ?? 0) === 0,
      })
      toast('Lahan ditambahkan'); setAdding(false); setLand({ village: '', district: '', city: '', province: '', landAreaHa: '' }); reload()
    } catch (ex) { toast((ex as Error).message, 'error') } finally { setBusy(false) }
  }

  if (loading) return <Empty text="Memuat profil…" />

  return (
    <div className="fade" style={{ padding: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Profil Saya</div>

      {/* Profil */}
      <div className="card" style={{ marginBottom: 12 }}>
        {!editing ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{data?.fullName}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Kelompok: {data?.farmerGroup ?? '—'}</div>
            <div className="muted" style={{ fontSize: 12 }}>Telp: {data?.phone ?? '—'}</div>
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>ID: {data?.farmerChainId}</div>
            <button className="btn sm" style={{ marginTop: 10 }} onClick={openEdit}>✏️ Edit Profil</button>
          </>
        ) : (
          <form onSubmit={saveProfile}>
            <div className="field"><label>Nama Lengkap</label><input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} required /></div>
            <div className="field"><label>Kelompok Tani</label><input value={form.farmerGroup} onChange={e => setForm({ ...form, farmerGroup: e.target.value })} /></div>
            <div className="field"><label>No. Telepon</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="row">
              <button className="btn sm" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
              <button type="button" className="btn sm secondary" onClick={() => setEditing(false)}>Batal</button>
            </div>
          </form>
        )}
      </div>

      {/* Ganti kata sandi */}
      <div className="card" style={{ marginBottom: 12 }}>
        {!pwOpen ? (
          <div className="between">
            <div style={{ fontWeight: 700, fontSize: 13 }}>🔒 Kata Sandi</div>
            <button className="btn sm secondary" onClick={() => setPwOpen(true)}>Ubah Kata Sandi</button>
          </div>
        ) : (
          <form onSubmit={savePassword}>
            <div className="field"><label>Kata Sandi Lama</label><input type="password" value={pw.old} onChange={e => setPw({ ...pw, old: e.target.value })} required /></div>
            <div className="field"><label>Kata Sandi Baru (min. 6)</label><input type="password" value={pw.neu} onChange={e => setPw({ ...pw, neu: e.target.value })} required minLength={6} /></div>
            <div className="row">
              <button className="btn sm" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
              <button type="button" className="btn sm secondary" onClick={() => { setPwOpen(false); setPw({ old: '', neu: '' }) }}>Batal</button>
            </div>
          </form>
        )}
      </div>

      {/* Lahan */}
      <div className="between" style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Lahan ({data?.lands.length ?? 0})</div>
        {!adding && <button className="btn xs" onClick={() => setAdding(true)}>+ Tambah Lahan</button>}
      </div>

      {(data?.lands ?? []).map(l => (
        <div key={l.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{l.village}, {l.province} {l.isPrimary && <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>Utama</span>}</div>
          <div className="muted" style={{ fontSize: 12 }}>{l.landAreaHa} ha · {[l.district, l.city].filter(Boolean).join(', ')}</div>
          {l.gpsLat != null && <div className="muted mono" style={{ fontSize: 11 }}>GPS: {l.gpsLat?.toFixed(5)}, {l.gpsLng?.toFixed(5)}</div>}
        </div>
      ))}
      {(data?.lands.length ?? 0) === 0 && !adding && <Empty text="Belum ada lahan. Tambah lahan pertama Anda." />}

      {adding && (
        <form className="card" onSubmit={saveLand} style={{ marginBottom: 10 }}>
          <h3>Tambah Lahan</h3>
          <div className="field"><label>Desa/Kelurahan</label><input value={land.village} onChange={e => setLand({ ...land, village: e.target.value })} required /></div>
          <div className="grid cols-2">
            <div className="field"><label>Kecamatan</label><input value={land.district} onChange={e => setLand({ ...land, district: e.target.value })} /></div>
            <div className="field"><label>Kota/Kabupaten</label><input value={land.city} onChange={e => setLand({ ...land, city: e.target.value })} /></div>
            <div className="field"><label>Provinsi</label><input value={land.province} onChange={e => setLand({ ...land, province: e.target.value })} /></div>
          </div>
          <div className="field"><label>Luas Lahan (ha)</label><input type="number" step="0.01" min="0.01" value={land.landAreaHa} onChange={e => setLand({ ...land, landAreaHa: e.target.value })} required /></div>
          <div className="field">
            <label>Titik GPS (geser pin / klik peta)</label>
            <MapPicker lat={gps.lat} lng={gps.lng} onChange={(la, ln) => setGps({ lat: la, lng: ln })} height={220} />
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</div>
          </div>
          <div className="row">
            <button className="btn sm" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan Lahan'}</button>
            <button type="button" className="btn sm secondary" onClick={() => setAdding(false)}>Batal</button>
          </div>
        </form>
      )}
    </div>
  )
}
