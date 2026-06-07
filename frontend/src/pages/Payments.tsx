import { api, fmtRpFull, shortTx } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast } from '../ui'

interface Payment {
  id: number; amountIdr: number; status: string; kemenkeuRef?: string; blockchainTxId?: string
  distribution?: { distributionChainId: string; farmer: string } | null
}

export default function Payments() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, reload } = useApi<Payment[]>('/payments')
  const isKemenkeu = user?.role === 'KEMENKEU'

  const approve = async (id: number) => {
    const ref = prompt('Nomor referensi pencairan Kemenkeu (SP2D):', 'SP2D-2026-' + String(id).padStart(4, '0'))
    if (!ref) return
    try { await api.post(`/payments/${id}/approve`, { paymentId: id, kemenkeuRef: ref }); toast('Subsidi dicairkan & dicatat on-chain'); reload() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }
  const reject = async (id: number) => {
    const reason = prompt('Alasan penolakan:')
    if (!reason) return
    try { await api.post(`/payments/${id}/reject`, { paymentId: id, reason }); toast('Klaim ditolak'); reload() }
    catch (ex) { toast((ex as Error).message, 'error') }
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
            {data?.map(p => (
              <tr key={p.id}>
                <td className="mono">{p.distribution?.distributionChainId}</td>
                <td>{p.distribution?.farmer}</td>
                <td><b>{fmtRpFull(p.amountIdr)}</b></td>
                <td className="mono">{p.kemenkeuRef ?? '—'}</td>
                <td><Badge status={p.status} /></td>
                <td className="mono">{shortTx(p.blockchainTxId)}</td>
                {isKemenkeu && <td>{p.status === 'REQUESTED' && (
                  <div className="row">
                    <button className="btn sm" onClick={() => approve(p.id)}>Cairkan</button>
                    <button className="btn sm danger" onClick={() => reject(p.id)}>Tolak</button>
                  </div>
                )}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
