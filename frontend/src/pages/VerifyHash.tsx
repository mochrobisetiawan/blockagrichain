import { useState } from 'react'
import { api, sha256Hex } from '../api'
import { useToast } from '../ui'

interface VerifyResult { match: boolean; onChainHash: string | null; submittedHash: string }

export default function VerifyHash() {
  const toast = useToast()
  const [objType, setObjType] = useState('HARVEST')
  const [objId, setObjId] = useState('HRV-0001')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)

  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setResult(null)
    try {
      const hash = await sha256Hex(content)
      const res = await api.post<VerifyResult>('/ledger/verify-hash', { objectType: objType, objectId: objId, hash })
      setResult(res)
    } catch (ex) { toast((ex as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="fade" style={{ maxWidth: 640 }}>
      <h1 className="page-title">Verification Tool — Cek Hash</h1>
      <p className="page-sub">Cocokkan hash file/dokumen dengan yang tersimpan immutable di ledger</p>

      <form className="card" style={{ marginTop: 18 }} onSubmit={run}>
        <div className="grid cols-2">
          <div className="field"><label>Tipe Objek</label>
            <select value={objType} onChange={e => setObjType(e.target.value)}>
              <option value="HARVEST">HARVEST (foto panen)</option>
              <option value="DIST">DIST (bukti serah terima)</option>
              <option value="POLICY">POLICY (dokumen kebijakan)</option>
            </select></div>
          <div className="field"><label>ID On-Chain</label>
            <input value={objId} onChange={e => setObjId(e.target.value)} className="mono" /></div>
        </div>
        <div className="field"><label>Isi file / teks (akan di-hash SHA-256 di browser)</label>
          <textarea rows={3} value={content} onChange={e => setContent(e.target.value)} placeholder="Tempel konten yang sama persis saat upload" /></div>
        <button className="btn" disabled={busy}>{busy ? 'Memeriksa…' : '🔍 Verifikasi'}</button>
      </form>

      {result && (
        <div className="card" style={{ marginTop: 14, borderColor: result.match ? 'var(--g200)' : 'var(--red)' }}>
          <div style={{ fontWeight: 700, color: result.match ? 'var(--g600)' : 'var(--red)' }}>
            {result.match ? '✓ COCOK — dokumen tidak diubah' : '✕ TIDAK COCOK — hash berbeda'}
          </div>
          <div className="chain-proof" style={{ marginTop: 10 }}>
            <div>On-chain : {result.onChainHash ?? '—'}</div>
            <div>Dihitung : {result.submittedHash}</div>
          </div>
        </div>
      )}
    </div>
  )
}
