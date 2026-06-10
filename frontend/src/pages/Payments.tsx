import { useState } from 'react'
import { api, fmtRpFull, shortTx } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast, usePaged } from '../ui'

interface Payment {
  id: number; amountIdr: number; status: string; kemenkeuRef?: string; blockchainTxId?: string
  distribution?: { distributionChainId: string; farmer: string } | null
}

export default function Payments() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, reload } = useApi<Payment[]>('/payments')
  const isKemenkeu = user?.role === 'KEMENKEU'
  const { pageItems, pager } = usePaged(data, 8)
  const [rejectId, setRejectId] = useState<number | null>(null)
  const [reason, setReason] = useState('')

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); reload() } catch (ex) { toast((ex as Error).message, 'error') }
  }
  // SP2D dibuat OTOMATIS (tanpa popup) — nomor referensi pencairan Kemenkeu.
  const approve = (id: number) =>
    wrap(() => api.post(`/payments/${id}/approve`, { paymentId: id, kemenkeuRef: 'SP2D-2026-' + String(id).padStart(4, '0') }), 'Subsidi dicairkan & dicatat on-chain')
  const doReject = (id: number) => {
    if (!reason.trim()) { toast('Alasan penolakan wajib diisi', 'error'); return }
    wrap(() => api.post(`/payments/${id}/reject`, { paymentId: id, reason }), 'Klaim ditolak')
    setRejectId(null); setReason('')
  }

  return (
    <div className="fade">
      <h1 className="page-title">{isKemenkeu ? 'Pencairan Subsidi' : 'Klaim Subsidi PIHC'}</h1>
      <p className="page-sub">{isKemenkeu ? 'Persetujuan & pencairan dana subsidi (tercatat immutable)' : 'Status klaim pencairan subsidi Anda'}</p>

      <div className="card" style={{ marginTop: 18, padding: 0 }}>
        <table>
          <thead><tr><th>Order</th><th>Petani</th><th>Nominal</th><th>Ref Kemenkeu</th><th>Status</th><th>TxID</th>{isKemenkeu && <th>Aksi</th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><Empty text="Memuat…" /></td></tr>}
            {!loading && data?.length === 0 && <tr><td colSpan={7}><Empty text="Belum ada klaim subsidi" /></td></tr>}
            {pageItems.map(p => (
              <tr key={p.id}>
                <td className="mono">{p.distribution?.distributionChainId}</td>
                <td>{p.distribution?.farmer}</td>
                <td><b>{fmtRpFull(p.amountIdr)}</b></td>
                <td className="mono">{p.kemenkeuRef ?? '—'}</td>
                <td><Badge status={p.status} /></td>
                <td className="mono">{shortTx(p.blockchainTxId)}</td>
                {isKemenkeu && <td>{p.status === 'REQUESTED' && (
                  rejectId === p.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input autoFocus placeholder="Alasan penolakan…" value={reason} onChange={e => setReason(e.target.value)}
                        style={{ padding: '6px 9px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 12, minWidth: 150 }} />
                      <button className="btn sm danger" onClick={() => doReject(p.id)}>Kirim</button>
                      <button className="btn sm secondary" onClick={() => { setRejectId(null); setReason('') }}>✕</button>
                    </div>
                  ) : (
                    <div className="row">
                      <button className="btn sm" style={{ background: '#1a5e38', color: '#fff' }} onClick={() => approve(p.id)}>💰 Cairkan</button>
                      <button className="btn sm danger" onClick={() => { setRejectId(p.id); setReason('') }}>Tolak</button>
                    </div>
                  )
                )}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  )
}
