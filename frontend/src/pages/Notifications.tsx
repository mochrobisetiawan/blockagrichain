import { api, shortTx } from '../api'
import { useApi } from '../hooks'
import { Empty, usePaged } from '../ui'

interface Notif {
  id: number; eventName: string; title: string; body: string; blockchainTxId?: string; isRead: boolean; createdAt: string
}

export default function Notifications() {
  const { data, loading, reload } = useApi<Notif[]>('/notifications')
  const { pageItems, pager } = usePaged(data, 5)
  const markRead = async (id: number) => { await api.post(`/notifications/${id}/read`); reload() }

  return (
    <div className="fade" style={{ maxWidth: 720 }}>
      <h1 className="page-title">Notifikasi</h1>
      <p className="page-sub">Event real-time dari smart contract (Transaction Feedback)</p>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <Empty text="Memuat…" />}
        {!loading && data?.length === 0 && <Empty text="Belum ada notifikasi" />}
        {pageItems.map(n => (
          <div key={n.id} className="card" style={{ borderLeft: `4px solid ${n.isRead ? 'var(--border)' : 'var(--g500)'}`, cursor: n.isRead ? 'default' : 'pointer' }}
            onClick={() => !n.isRead && markRead(n.id)}>
            <div className="between">
              <div style={{ fontWeight: 700 }}>{n.title}</div>
              <span className="badge" style={{ background: 'var(--g50)', color: 'var(--g700)' }}>{n.eventName}</span>
            </div>
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{n.body}</div>
            {n.blockchainTxId && <div className="mono" style={{ fontSize: 11, marginTop: 6, color: 'var(--g600)' }}>TxID: {shortTx(n.blockchainTxId)}</div>}
          </div>
        ))}
      </div>
      {pager}
    </div>
  )
}
