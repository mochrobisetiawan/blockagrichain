import { useEffect, useRef, useState } from 'react'
import { api, fetchObjectUrl, fmt, shortTx, type ChainProof } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast } from '../ui'
import DetailModal from '../components/DetailModal'

const C = { g700: '#1a5e38', g600: '#22773f', blue: '#2563eb', amber: '#d97706', red: '#dc2626' }

interface Harvest {
  id: number; harvestChainId: string; cropType: string; qtyClaimedKg: number; status: string
  harvestDocHash: string; blockchainTxId?: string; submittedAt: string
  farmer?: { fullName: string; farmerGroup: string; farmerChainId: string }
  land?: { village: string; province: string; landAreaHa: number; gpsLat: number; gpsLng: number }
  allocation?: { ureaKg: number; npkKg: number; organicKg: number } | null
  iotImageUrl?: string; iotWeightKg?: number; iotOcrRaw?: string; iotDeviceId?: string
  harvestPhotoUrl?: string; bulogPhotoUrl?: string
}

/* ───── Modal Verifikasi Fisik (gaya prototype + IoT Smart Scale) ───── */
function VerifModal({ h, onClose, onDone }: { h: Harvest; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [hv, setHv] = useState<Harvest>(h)                 // data panen yang bisa di-refresh
  const [weight, setWeight] = useState(String(h.iotWeightKg ?? Math.round(h.qtyClaimedKg * 0.97)))
  const touchedRef = useRef(false)                         // user sudah mengubah berat manual? (ref agar tak basi di interval)
  const [busy, setBusy] = useState<string>('')
  const [proof, setProof] = useState<ChainProof | null>(null)
  const [rejectMode, setRejectMode] = useState(false)
  const [reason, setReason] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const iotW = Number(weight) || 0
  const delta = hv.qtyClaimedKg ? Math.abs((hv.qtyClaimedKg - iotW) / hv.qtyClaimedKg * 100) : 0
  const ok = delta < 10

  // refresh data panen (mengambil data IoT yang baru masuk) — manual + otomatis tiap 8 dtk.
  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await api.get<{ offChain: Harvest }>(`/harvests/${h.id}`)
      if (res.offChain) {
        setHv(res.offChain)
        if (!touchedRef.current && res.offChain.iotWeightKg) setWeight(String(res.offChain.iotWeightKg))
      }
    } catch { /* abaikan */ } finally { setRefreshing(false) }
  }
  useEffect(() => { const t = setInterval(refresh, 8000); return () => clearInterval(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // tiga gambar (proxy privat S3): panen petani, display timbangan IoT, bukti fisik Bulog.
  const [imgFarmer, setImgFarmer] = useState('')
  const [imgIot, setImgIot] = useState('')
  const [imgBulog, setImgBulog] = useState('')
  useEffect(() => {
    const urls: string[] = []
    const load = (has: boolean, kind: string, set: (s: string) => void) => {
      if (!has) { set(''); return }
      fetchObjectUrl(`/harvests/${h.id}/photo?kind=${kind}`).then(u => { urls.push(u); set(u) }).catch(() => {})
    }
    load(!!hv.harvestPhotoUrl, 'harvest', setImgFarmer)
    load(!!hv.iotImageUrl, 'iot', setImgIot)
    load(!!hv.bulogPhotoUrl, 'bulog', setImgBulog)
    return () => urls.forEach(u => URL.revokeObjectURL(u))
  }, [h.id, hv.harvestPhotoUrl, hv.iotImageUrl, hv.bulogPhotoUrl])

  const decide = async (decision: 'APPROVED' | 'REJECTED', rj = '') => {
    setBusy(decision)
    try {
      const res = await api.post<{ proof: ChainProof }>('/verifications', {
        harvestId: h.id, measuredWeightKg: iotW, ocrWeightRaw: weight, decision, rejectReason: rj,
      })
      setProof(res.proof)
      toast(decision === 'APPROVED' ? 'Disetujui — smart contract menghitung alokasi otomatis' : 'Laporan ditolak')
      setTimeout(onDone, 1300)
    } catch (ex) { toast((ex as Error).message, 'error'); setBusy('') }
  }

  const info: [string, string][] = [
    ['Tanaman', hv.cropType], ['Lahan', `${hv.land?.landAreaHa ?? '—'} Ha`], ['Provinsi', hv.land?.province ?? '—'],
    ['Klaim', `${fmt(hv.qtyClaimedKg)} kg`], ['Desa', hv.land?.village ?? '—'], ['Tanggal', (hv.submittedAt ?? '').slice(0, 10)],
  ]
  const ImgCell = ({ label, src, has }: { label: string; src: string; has: boolean }) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txtM)', marginBottom: 4 }}>{label}</div>
      {!has ? <div style={{ height: 92, display: 'grid', placeItems: 'center', background: '#f3f4f6', borderRadius: 9, color: 'var(--txtS)', fontSize: 16 }}>—</div>
        : src ? <img src={src} alt={label} style={{ width: '100%', height: 92, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--border)' }} />
        : <div style={{ height: 92, display: 'grid', placeItems: 'center', background: '#f3f4f6', borderRadius: 9, color: 'var(--txtS)', fontSize: 11 }}>Memuat…</div>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }} onClick={onClose}>
      <div className="fade" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Verifikasi Fisik</div>
            <div style={{ fontSize: 12, color: 'var(--txtS)', fontFamily: 'monospace' }}>{hv.harvestChainId} · {hv.farmer?.fullName}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refresh} disabled={refreshing} title="Muat ulang data IoT" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)', background: '#f3f4f6', fontSize: 14, color: 'var(--txtM)' }}>{refreshing ? '…' : '🔄'}</button>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)', background: '#f3f4f6', fontSize: 14, color: 'var(--txtS)' }}>✕</button>
          </div>
        </div>
        <div style={{ padding: '18px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
            {info.map(([k, v]) => (
              <div key={k} style={{ background: '#f9fafb', borderRadius: 10, padding: '9px 13px' }}>
                <div style={{ fontSize: 10, color: 'var(--txtS)', fontWeight: 600, marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Tiga gambar: panen petani, display timbangan IoT, bukti fisik Bulog */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txtM)' }}>Bukti Gambar</div>
            {hv.iotDeviceId && <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: C.blue, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 20, padding: '2px 9px' }}>🔌 {hv.iotDeviceId}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <ImgCell label="📷 Panen (Petani)" src={imgFarmer} has={!!hv.harvestPhotoUrl} />
            <ImgCell label="⚖️ Display Timbangan (IoT)" src={imgIot} has={!!hv.iotImageUrl} />
            <ImgCell label="🟢 Bukti Fisik (Bulog)" src={imgBulog} has={!!hv.bulogPhotoUrl} />
          </div>
          {hv.iotOcrRaw && <div style={{ fontSize: 11, color: 'var(--txtS)', marginBottom: 8 }}>Hasil OCR mentah: <b className="mono">{hv.iotOcrRaw}</b></div>}
          {!hv.iotImageUrl && (
            <div style={{ marginBottom: 14, background: 'var(--amberL)', color: '#92400e', borderRadius: 10, padding: '10px 13px', fontSize: 12 }}>
              📡 Data IoT/timbangan belum masuk — tunggu kiriman ESP32 (auto-refresh tiap 8 dtk) atau tekan 🔄, atau isi berat manual.
            </div>
          )}

          {/* Input berat OCR */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--txtM)', display: 'block', marginBottom: 5 }}>Berat Terukur IoT / OCR (kg)</label>
            <input type="number" value={weight} onChange={e => { setWeight(e.target.value); touchedRef.current = true }} disabled={!!busy}
              style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1.5px solid var(--border)', fontSize: 14 }} />
          </div>

          {/* IoT result */}
          <div style={{ background: ok ? '#f0faf5' : '#fee2e2', borderRadius: 14, padding: '14px 16px', marginBottom: 16, border: `1px solid ${ok ? 'var(--g200)' : '#fca5a5'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: ok ? C.g700 : C.red }}>📡 IoT Smart Scale + OCR (ESP32-CAM)</div>
              {hv.iotDeviceId && <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--txtM)' }}>🔌 {hv.iotDeviceId}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
              <div><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--txtM)' }}>{fmt(hv.qtyClaimedKg)} kg</div><div style={{ fontSize: 10, color: 'var(--txtS)' }}>Klaim Petani</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 800, color: C.blue }}>{fmt(iotW)} kg</div><div style={{ fontSize: 10, color: 'var(--txtS)' }}>Terukur IoT</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 800, color: ok ? C.g600 : C.red }}>Δ {delta.toFixed(1)}%</div><div style={{ fontSize: 10, color: 'var(--txtS)' }}>Selisih</div></div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: ok ? C.g700 : C.red, fontWeight: 600 }}>{ok ? '✓ Dalam batas toleransi (< 10%) — dapat disetujui' : '⚠ Melebihi batas toleransi (> 10%) — perlu penolakan'}</div>
          </div>

          <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--txtS)', background: '#f3f4f6', padding: '8px 12px', borderRadius: 8, marginBottom: 18 }}>
            Hash dok: {shortTx(hv.harvestDocHash)} · GPS: {hv.land?.gpsLat}, {hv.land?.gpsLng} · MSP: BulogMSP
          </div>

          {proof ? (
            <div style={{ textAlign: 'center', padding: 16, background: '#f0faf5', borderRadius: 14 }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>✅</div>
              <div style={{ fontWeight: 700, color: C.g700, marginBottom: 6 }}>Tercatat di blockchain</div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--txtS)' }}>TxID {shortTx(proof.txId)} · Block #{proof.blockNumber}</div>
            </div>
          ) : rejectMode ? (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.red, display: 'block', marginBottom: 5 }}>Alasan penolakan (wajib)</label>
              <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. berat tidak sesuai / dokumen tidak valid"
                style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.red}`, fontSize: 14, marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => reason.trim() && decide('REJECTED', reason)} disabled={!!busy || !reason.trim()} style={{ flex: 2, padding: 12, borderRadius: 12, border: 'none', background: C.red, color: '#fff', fontWeight: 700, fontSize: 14, opacity: reason.trim() ? 1 : .5 }}>{busy === 'REJECTED' ? 'Memproses…' : '✕ Konfirmasi Tolak'}</button>
                <button onClick={() => { setRejectMode(false); setReason('') }} disabled={!!busy} style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: '#f3f4f6', color: 'var(--txtM)', fontWeight: 700, fontSize: 14 }}>Batal</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRejectMode(true)} disabled={!!busy} style={{ flex: 1, padding: 12, borderRadius: 12, border: `2px solid ${C.red}`, background: 'var(--redL)', color: C.red, fontWeight: 700, fontSize: 14 }}>✕ Tolak</button>
              <button onClick={() => decide('APPROVED')} disabled={!!busy} style={{ flex: 2, padding: 12, borderRadius: 12, border: 'none', background: C.g600, color: '#fff', fontWeight: 700, fontSize: 14 }}>{busy === 'APPROVED' ? 'Menandatangani HSM…' : '✓ Setujui & Tanda Tangan Digital (HSM)'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Harvests() {
  const { user } = useAuth()
  const isBulog = user?.role === 'BULOG'
  const isFarmer = user?.role === 'FARMER'
  const { data, loading, reload } = useApi<Harvest[]>(isBulog ? '/harvests/pending' : '/harvests')
  const [modal, setModal] = useState<Harvest | null>(null)
  const [detail, setDetail] = useState<Harvest | null>(null)
  const hStage = (st: string) => st === 'VERIFIED' ? 2 : 1
  const detailModal = detail && (
    <DetailModal type="HARVEST" id={detail.harvestChainId} stage={hStage(detail.status)}
      title={`Panen · ${detail.cropType}`} badge={<Badge status={detail.status} />}
      fields={[
        { label: 'Komoditas', value: detail.cropType },
        { label: 'Kuantitas klaim', value: `${fmt(detail.qtyClaimedKg)} kg` },
        { label: 'Provinsi', value: detail.land?.province ?? '—' },
        { label: 'Berat IoT (OCR)', value: detail.iotWeightKg ? `${fmt(detail.iotWeightKg)} kg` : '—' },
        { label: 'Perangkat IoT', value: detail.iotDeviceId ? <span className="mono">🔌 {detail.iotDeviceId}</span> : '—' },
        { label: 'Alokasi', value: detail.allocation ? `${detail.allocation.ureaKg}/${detail.allocation.npkKg}/${detail.allocation.organicKg} kg` : '—' },
      ]}
      onClose={() => setDetail(null)} />
  )

  /* Bulog — kartu antrian verifikasi */
  if (isBulog) {
    return (
      <div className="fade">
        <h1 className="page-title">Antrian Verifikasi Fisik</h1>
        <p className="page-sub">Laporan panen menunggu validasi lapangan oleh petugas Bulog</p>
        {loading ? <Empty text="Memuat…" /> : (data?.length ?? 0) === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--txtS)', fontSize: 14 }}>✅ Semua laporan telah diverifikasi</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16, marginTop: 18 }}>
            {data?.map(h => (
              <div key={h.id} onClick={() => setDetail(h)} title="Klik untuk detail & riwayat on-chain" style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid var(--border)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><Badge status={h.status} /><span style={{ fontSize: 11, color: 'var(--txtS)' }}>{(h.submittedAt ?? '').slice(0, 10)}</span></div>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 3 }}>{h.farmer?.fullName}</div>
                <div style={{ fontSize: 12, color: 'var(--txtS)', marginBottom: 14 }}>{h.land?.village}, {h.land?.province}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {([['Tanaman', h.cropType], ['Klaim', `${fmt(h.qtyClaimedKg)} kg`], ['Lahan', `${h.land?.landAreaHa ?? '—'} Ha`], ['ID', h.harvestChainId]] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ background: '#f9fafb', borderRadius: 9, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: 'var(--txtS)' }}>{k}</div>
                      <div style={{ fontWeight: 700, fontSize: 12, fontFamily: k === 'ID' ? 'monospace' : 'inherit' }}>{v}</div>
                    </div>
                  ))}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setModal(h) }} className="btn" style={{ width: '100%', justifyContent: 'center' }}>Mulai Verifikasi Fisik</button>
              </div>
            ))}
          </div>
        )}
        {modal && <VerifModal h={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
        {detailModal}
      </div>
    )
  }

  /* Farmer — kartu status (di dalam phone) */
  if (isFarmer) {
    return (
      <div className="fade" style={{ padding: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>Status Laporan Panen</div>
        {loading && <Empty text="Memuat…" />}
        {!loading && (data?.length ?? 0) === 0 && <Empty text="Belum ada laporan panen." />}
        {data?.map(h => (
          <div key={h.id} onClick={() => setDetail(h)} style={{ background: '#fff', borderRadius: 14, padding: 13, marginBottom: 9, border: '1px solid var(--border)', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{h.cropType} · {fmt(h.qtyClaimedKg)} kg</div>
              <Badge status={h.status} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--txtS)', marginBottom: 5 }}>{h.land?.province} · {(h.submittedAt ?? '').slice(0, 10)}</div>
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--txtS)', background: '#f3f4f6', padding: '4px 8px', borderRadius: 6 }}>TX: {shortTx(h.blockchainTxId)}</div>
            {h.allocation && (
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, textAlign: 'center' }}>
                {[['Urea', h.allocation.ureaKg], ['NPK', h.allocation.npkKg], ['Organik', h.allocation.organicKg]].map(([l, v]) => (
                  <div key={l} style={{ background: '#f0faf5', borderRadius: 8, padding: '5px 3px' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.g700 }}>{v as number}kg</div>
                    <div style={{ fontSize: 9, color: 'var(--txtS)' }}>{l as string}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {detailModal}
      </div>
    )
  }

  /* Lain — tabel */
  return (
    <div className="fade">
      <h1 className="page-title">Status Panen & Alokasi</h1>
      <p className="page-sub">Mirror dari immutable ledger blockchain · klik baris untuk detail</p>
      <div className="card" style={{ marginTop: 18, padding: 0 }}>
        <table>
          <thead><tr><th>ID On-Chain</th><th>Komoditas</th><th>Kuantitas</th><th>Alokasi</th><th>Status</th><th>TxID</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><Empty text="Memuat…" /></td></tr>}
            {data?.map(h => (
              <tr key={h.id} onClick={() => setDetail(h)} style={{ cursor: 'pointer' }}>
                <td className="mono">{h.harvestChainId}</td>
                <td>{h.cropType}<div className="muted" style={{ fontSize: 12 }}>{h.land?.province}</div></td>
                <td>{fmt(h.qtyClaimedKg)} kg</td>
                <td>{h.allocation ? `${h.allocation.ureaKg} / ${h.allocation.npkKg} / ${h.allocation.organicKg} kg` : '—'}</td>
                <td><Badge status={h.status} /></td>
                <td className="mono">{shortTx(h.blockchainTxId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detailModal}
    </div>
  )
}
