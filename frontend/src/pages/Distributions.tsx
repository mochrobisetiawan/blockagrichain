import { useState } from 'react'
import { api, shortTx } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast, usePaged } from '../ui'
import DetailModal from '../components/DetailModal'

const C = { g700: '#1a5e38', g600: '#22773f', blue: '#2563eb', amber: '#d97706' }

interface Ready {
  id: number; ureaKg: number; npkKg: number; organicKg: number
  harvest: { harvestChainId: string; cropType: string; qtyClaimedKg: number }
  farmer: { fullName: string; farmerChainId: string }
}
interface Order {
  id: number; distributionChainId: string; status: string; blockchainTxId?: string; scheduledDate?: string
  allocation?: { ureaKg: number; npkKg: number; organicKg: number } | null
  farmer?: { fullName: string; farmerChainId: string } | null
  payment?: { id: number; amountIdr: number; status: string } | null
}

export default function Distributions() {
  const { user } = useAuth()
  const toast = useToast()
  const isPihc = user?.role === 'PIHC'
  const isFarmer = user?.role === 'FARMER'
  const { data: orders, loading, reload } = useApi<Order[]>('/distributions')
  const { data: ready, reload: reloadReady } = useApi<Ready[]>(isPihc ? '/distributions/ready' : null)
  const [detail, setDetail] = useState<Order | null>(null)
  const { pageItems: pagedOrders, pager } = usePaged(orders, 9)
  const [claimOpen, setClaimOpen] = useState<Record<number, boolean>>({})
  const [claimAmt, setClaimAmt] = useState<Record<number, string>>({})
  const distStage = (o: Order) => o.payment?.status === 'DISBURSED' ? 6 : o.payment?.status === 'REQUESTED' ? 5
    : (o.status === 'CONFIRMED' || o.status === 'DELIVERED') ? 4 : 3
  const defaultClaim = (o: Order) => String((o.allocation?.ureaKg ?? 0) * 2250 + (o.allocation?.npkKg ?? 0) * 2300)
  // gaya tombol per tahap — beda warna + ikon sebagai pembeda
  const bs = (bg: string): React.CSSProperties => ({ width: '100%', justifyContent: 'center', background: bg, border: 'none', color: '#fff', borderRadius: 10, padding: '10px', fontWeight: 700, fontSize: 13, cursor: 'pointer' })

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); reload(); reloadReady() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }
  const create = (allocationId: number) =>
    wrap(() => api.post('/distributions', { allocationId, scheduledDate: new Date(Date.now() + 6048e5).toISOString().slice(0, 10) }), 'Order distribusi dibuat on-chain')
  const setStatus = (id: number, newStatus: string, photo?: string) =>
    wrap(() => api.patch(`/distributions/${id}/status`, { newStatus, deliveryPhotoUrl: photo }), `Status → ${newStatus}`)
  const ship = (id: number) => setStatus(id, 'SHIPPED')
  const deliver = (id: number) => setStatus(id, 'DELIVERED')   // tanpa popup URL S3
  const confirm = (id: number) => setStatus(id, 'CONFIRMED')
  const submitClaim = (o: Order) => {
    const amt = Number(claimAmt[o.id] ?? defaultClaim(o))
    if (!amt || amt <= 0) { toast('Nominal klaim tidak valid', 'error'); return }
    wrap(() => api.post('/payments/request', { distributionOrderId: o.id, amountIdr: amt }), 'Klaim subsidi diajukan ke Kemenkeu')
    setClaimOpen({ ...claimOpen, [o.id]: false })
  }

  const tiles = (a?: { ureaKg: number; npkKg: number; organicKg: number } | null) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
      {[{ l: 'Urea', v: a?.ureaKg ?? 0, c: C.g700 }, { l: 'NPK', v: a?.npkKg ?? 0, c: C.blue }, { l: 'Organik', v: a?.organicKg ?? 0, c: C.amber }].map(x => (
        <div key={x.l} style={{ background: '#f9fafb', borderRadius: 9, padding: '7px 5px', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: x.c }}>{x.v}kg</div>
          <div style={{ fontSize: 9, color: 'var(--txtS)' }}>{x.l}</div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="fade">
      <h1 className="page-title">{isFarmer ? 'Distribusi Pupuk Saya' : 'Manajemen Distribusi'}</h1>
      <p className="page-sub">Rantai status: CREATED → SHIPPED → DELIVERED → CONFIRMED (petani) → klaim subsidi</p>

      {isPihc && ready && ready.length > 0 && (
        <>
          <div style={{ fontSize: 14, fontWeight: 800, margin: '20px 0 12px' }}>Alokasi Siap Distribusi ({ready.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
            {ready.map(r => (
              <div key={r.id} style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid var(--g200)' }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{r.farmer.fullName}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--txtS)', marginBottom: 12 }}>{r.harvest.harvestChainId}</div>
                {tiles(r)}
                <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => create(r.id)}>🚚 Buat Order Distribusi</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 14, fontWeight: 800, margin: '22px 0 12px' }}>Order Distribusi {isFarmer ? '' : 'Aktif'}</div>
      {loading ? <Empty text="Memuat…" /> : (orders?.length ?? 0) === 0 ? <Empty text="Belum ada order distribusi" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
          {pagedOrders.map(o => (
            <div key={o.id} style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><Badge status={o.status} /><span style={{ fontSize: 11, color: 'var(--txtS)' }}>{o.scheduledDate ?? ''}</span></div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{o.farmer?.fullName ?? '—'}</div>
              <div onClick={() => setDetail(o)} title="Lihat detail & riwayat on-chain" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--g700)', marginBottom: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>🔍 {o.distributionChainId} · {shortTx(o.blockchainTxId)}</div>
              {tiles(o.allocation)}
              {isPihc && o.status === 'CREATED' && <button style={bs('#2563eb')} onClick={() => ship(o.id)}>🚚 Kirim Pupuk</button>}
              {isPihc && o.status === 'SHIPPED' && <button style={bs('#d97706')} onClick={() => deliver(o.id)}>📦 Tandai Terkirim</button>}
              {isFarmer && o.status === 'DELIVERED' && <button style={bs('#1a5e38')} onClick={() => confirm(o.id)}>✓ Konfirmasi Diterima</button>}
              {isPihc && o.status === 'CONFIRMED' && !o.payment && (
                !claimOpen[o.id]
                  ? <button style={bs('#7c3aed')} onClick={() => setClaimOpen({ ...claimOpen, [o.id]: true })}>🧾 Ajukan Klaim Subsidi</button>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--txtM)' }}>Nominal klaim subsidi (IDR)</label>
                      <input type="number" min="1" value={claimAmt[o.id] ?? defaultClaim(o)} onChange={e => setClaimAmt({ ...claimAmt, [o.id]: e.target.value })}
                        style={{ padding: '9px 11px', borderRadius: 9, border: '1.5px solid var(--border)', fontSize: 13 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={bs('#7c3aed')} onClick={() => submitClaim(o)}>Ajukan</button>
                        <button onClick={() => setClaimOpen({ ...claimOpen, [o.id]: false })} style={{ background: '#f3f4f6', border: '1px solid var(--border)', borderRadius: 9, padding: '0 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Batal</button>
                      </div>
                    </div>
                  )
              )}
              {o.payment && <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600 }}>Klaim: <Badge status={o.payment.status} /></div>}
              {o.status === 'DELIVERED' && isPihc && <div style={{ textAlign: 'center', fontSize: 12, color: C.amber, fontWeight: 600 }}>⏳ Menunggu konfirmasi petani</div>}
            </div>
          ))}
        </div>
      )}
      {pager}

      {detail && (
        <DetailModal type="DIST" id={detail.distributionChainId} stage={distStage(detail)}
          title={`Distribusi · ${detail.farmer?.fullName ?? ''}`}
          badge={<Badge status={detail.status} />}
          fields={[
            { label: 'Petani', value: detail.farmer?.fullName ?? '—' },
            { label: 'Jadwal', value: detail.scheduledDate ?? '—' },
            { label: 'Urea/NPK/Organik', value: detail.allocation ? `${detail.allocation.ureaKg}/${detail.allocation.npkKg}/${detail.allocation.organicKg} kg` : '—' },
            { label: 'Status klaim', value: detail.payment ? detail.payment.status : '—' },
          ]}
          onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
