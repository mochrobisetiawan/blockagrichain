import { useEffect, useState } from 'react'
import { api, shortTx } from '../api'

// Alur global hulu→hilir (D1). Index 0..6.
const STAGES = ['Panen', 'Verifikasi', 'Alokasi', 'Distribusi', 'Diterima', 'Klaim', 'Pencairan']

function FlowTimeline({ stage }: { stage: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, margin: '6px 0 18px', overflowX: 'auto' }}>
      {STAGES.map((s, i) => {
        const done = i < stage, active = i === stage
        const color = done ? 'var(--g600)' : active ? 'var(--blue)' : '#d1d5db'
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STAGES.length - 1 ? 1 : '0 0 auto', minWidth: 64 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: done || active ? color : '#fff', border: `2px solid ${color}`, boxShadow: active ? '0 0 0 3px var(--blueL)' : 'none' }} />
              <div style={{ fontSize: 9, fontWeight: active ? 700 : 600, color: done || active ? 'var(--txt)' : 'var(--txtS)', textAlign: 'center', whiteSpace: 'nowrap' }}>{s}</div>
            </div>
            {i < STAGES.length - 1 && <div style={{ flex: 1, height: 2, background: i < stage ? 'var(--g500)' : '#e5e7eb', margin: '0 2px', marginBottom: 16 }} />}
          </div>
        )
      })}
    </div>
  )
}

interface HistItem { txId: string; timestamp: string; isDelete: boolean; data?: Record<string, unknown> }

export default function DetailModal({ title, badge, type, id, stage, fields, onClose }: {
  title: string; badge?: React.ReactNode; type: string; id: string; stage: number
  fields: { label: string; value: React.ReactNode }[]; onClose: () => void
}) {
  const [hist, setHist] = useState<HistItem[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api.get<{ history: HistItem[] }>(`/ledger/history/${type}/${id}`)
      .then(r => setHist(r.history || [])).catch(() => setHist([])).finally(() => setLoading(false))
  }, [type, id])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }} onClick={onClose}>
      <div className="fade" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div><div className="mono" style={{ fontSize: 12, color: 'var(--txtS)' }}>{id}</div></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{badge}<button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)', background: '#f3f4f6', fontSize: 14 }}>✕</button></div>
        </div>
        <div style={{ padding: 20 }}>
          <FlowTimeline stage={stage} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            {fields.map(f => (
              <div key={f.label} style={{ background: '#f9fafb', borderRadius: 10, padding: '9px 13px' }}>
                <div style={{ fontSize: 10, color: 'var(--txtS)', fontWeight: 600, marginBottom: 2 }}>{f.label}</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{f.value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Riwayat On-Chain (immutable)</div>
          {loading ? <div className="muted" style={{ fontSize: 13 }}>Memuat riwayat…</div>
            : hist.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Belum ada riwayat transaksi untuk objek ini.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hist.map((h, i) => (
                  <div key={i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 13px', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--g700)' }}>TxID {shortTx(h.txId)}</div>
                      <div style={{ fontSize: 11, color: 'var(--txtS)' }}>{h.isDelete ? 'Dihapus' : (h.data?.status as string) ?? 'Update'}</div>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--txtS)', textAlign: 'right' }}>{String(h.timestamp).replace('T', ' ').slice(0, 19)}</div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
