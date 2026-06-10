import { useState } from 'react'
import { api, sha256File, sha256Hex, uploadToS3, type ChainProof } from '../api'
import { useApi } from '../hooks'
import { ChainProofBox, useToast } from '../ui'
import MapPicker from '../components/MapPicker'

interface Land { id: number; village: string; district: string; province: string; landAreaHa: number; gpsLat: number; gpsLng: number; isPrimary: boolean }
interface Profile { lands: Land[] }

export default function SubmitHarvest() {
  const { data: profile } = useApi<Profile>('/farmers/me')
  const toast = useToast()
  const [crop, setCrop] = useState('Padi')
  const [qty, setQty] = useState('')
  const [landId, setLandId] = useState<number | ''>('')
  const [photo, setPhoto] = useState('')          // URL object S3
  const [photoName, setPhotoName] = useState('')   // nama file terpilih
  const [preview, setPreview] = useState('')       // preview lokal gambar
  const [fileHash, setFileHash] = useState('')     // SHA-256 isi file
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proof, setProof] = useState<ChainProof | null>(null)
  const [hash, setHash] = useState('')

  const land = profile?.lands.find(l => l.id === landId) ?? profile?.lands[0]

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setPhotoName(file.name)
    setPreview(URL.createObjectURL(file))   // tampilkan preview lokal langsung
    try {
      const fh = await sha256File(file)       // hash isi file (untuk ledger)
      setFileHash(fh)
      const url = await uploadToS3('harvest', file) // unggah ke S3 off-chain
      setPhoto(url)
      toast('Foto terunggah ke S3 (off-chain) — hanya hash yang masuk ledger')
    } catch {
      toast('Gagal mengunggah foto. Coba lagi.', 'error')
      setPhotoName('')
    } finally { setUploading(false) }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!land || !qty) return
    setBusy(true); setProof(null)
    try {
      const photoUrl = photo || 's3://harvest/manual-url.jpg'
      const docHash = fileHash || await sha256Hex(`${photoUrl}|${qty}|${Date.now()}`)
      setHash(docHash)
      const res = await api.post<{ proof: ChainProof }>('/harvests', {
        landId: land.id, cropType: crop, qtyClaimedKg: Number(qty),
        harvestDocHash: docHash, harvestPhotoUrl: photoUrl,
      })
      setProof(res.proof)
      toast('Laporan panen tercatat di blockchain (PENDING verifikasi Bulog)')
      setQty(''); setPhoto(''); setPhotoName(''); setFileHash(''); setPreview('')
    } catch (ex) { toast((ex as Error).message, 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="fade" style={{ maxWidth: 640 }}>
      <h1 className="page-title">Input Data Panen</h1>
      <p className="page-sub">Foto diunggah ke S3 (off-chain); hanya SHA-256-nya yang masuk ledger.</p>

      <form className="card" style={{ marginTop: 18 }} onSubmit={submit}>
        <div className="field">
          <label>Jenis Tanaman</label>
          <select value={crop} onChange={e => setCrop(e.target.value)}>
            <option>Padi</option><option>Jagung</option><option>Kedelai</option>
          </select>
        </div>
        <div className="field">
          <label>Kuantitas Panen (kg)</label>
          <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="contoh: 2500" required />
        </div>
        <div className="field">
          <label>Lahan</label>
          <select value={landId} onChange={e => setLandId(Number(e.target.value))}>
            {profile?.lands.map(l => (
              <option key={l.id} value={l.id}>{l.village}, {l.province} ({l.landAreaHa} ha)</option>
            ))}
          </select>
        </div>
        {land && (
          <div className="field">
            <label>Lokasi Lahan</label>
            <input className="mono" value={`${land.gpsLat}, ${land.gpsLng}`} readOnly style={{ marginBottom: 8 }} />
            <MapPicker lat={land.gpsLat} lng={land.gpsLng} onChange={() => {}} height={220} />
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>📍 {land.village}, {land.district}, {land.province}</div>
          </div>
        )}

        <div className="field">
          <label>Foto Bukti Panen (unggah ke S3)</label>
          <input type="file" accept="image/*" onChange={onFile} disabled={uploading} />
          {uploading && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Mengunggah ke S3…</div>}
          {preview && (
            <img src={preview} alt="tumpukan panen" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 10, marginTop: 8, border: '1px solid var(--border)' }} />
          )}
          {photo && (
            <div className="chain-proof" style={{ marginTop: 8 }}>
              ✅ {photoName} terunggah ke penyimpanan off-chain
              <div style={{ marginTop: 4 }}>SHA-256: {fileHash.slice(0, 32)}…</div>
            </div>
          )}
        </div>

        <button className="btn" disabled={busy || uploading}>{busy ? 'Mencatat ke blockchain…' : '🌾 Submit Laporan Panen'}</button>
      </form>

      {hash && <div className="chain-proof" style={{ marginTop: 14 }}>SHA-256 dokumen: {hash}</div>}
      {proof && <div style={{ marginTop: 14 }}><ChainProofBox proof={proof} /></div>}
    </div>
  )
}
