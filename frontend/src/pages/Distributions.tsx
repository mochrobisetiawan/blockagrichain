import { useState } from 'react'
import { api, shortTx } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast } from '../ui'
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
  const distStage = (o: Order) => o.payment?.status === 'DISBURSED' ? 6 : o.payment?.status === 'REQUESTED' ? 5
    : (o.status === 'CONFIRMED' || o.status === 'DELIVERED') ? 4 : 3

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); reload(); reloadReady() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }
  const create = (allocationId: number) =>
    wrap(() => api.post('/distributions', { allocationId, scheduledDate: new Date(Date.now() + 6048e5).toISOString().slice(0, 10) }), 'Order distribusi dibuat on-chain')
  const setStatus = (id: number, newStatus: string, photo?: string) =>
    wrap(() => api.patch(`/distributions/${id}/status`, { newStatus, deliveryPhotoUrl: photo }), `Status → ${newStatus}`)
  const ship = (id: number) => setStatus(id, 'SHIPPED')
  const deliver = (id: number) => { const u = prompt('URL foto bukti serah terima:', 's3://proof/serah-terima.jpg'); if (u) setStatus(id, 'DELIVERED', u) }
  const confirm = (id: number) => setStatus(id, 'CONFIRMED')
  const claim = (o: Order) => {
    const amt = prompt('Nominal klaim subsidi (IDR):', String((o.allocation?.ureaKg ?? 0) * 2250 + (o.allocation?.npkKg ?? 0) * 2300))
    if (amt) wrap(() => api.post('/payments/request', { distributionOrderId: o.id, amountIdr: Number(amt) }), 'Klaim subsidi diajukan ke Kemenkeu')
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
          {orders?.map(o => (
            <div key={o.id} style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><Badge status={o.status} /><span style={{ fontSize: 11, color: 'var(--txtS)' }}>{o.scheduledDate ?? ''}</span></div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{o.farmer?.fullName ?? '—'}</div>
              <div onClick={() => setDetail(o)} title="Lihat detail & riwayat on-chain" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--g700)', marginBottom: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>🔍 {o.distributionChainId} · {shortTx(o.blockchainTxId)}</div>
              {tiles(o.allocation)}
              {isPihc && o.status === 'CREATED' && <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => ship(o.id)}>Kirim</button>}
              {isPihc && o.status === 'SHIPPED' && <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => deliver(o.id)}>Tandai Terkirim</button>}
              {isFarmer && o.status === 'DELIVERED' && <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => confirm(o.id)}>✓ Konfirmasi Diterima</button>}
              {isPihc && o.status === 'CONFIRMED' && !o.payment && <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => claim(o)}>Ajukan Klaim Subsidi</button>}
              {o.payment && <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600 }}>Klaim: <Badge status={o.payment.status} /></div>}
              {o.status === 'DELIVERED' && isPihc && <div style={{ textAlign: 'center', fontSize: 12, color: C.amber, fontWeight: 600 }}>⏳ Menunggu konfirmasi petani</div>}
            </div>
          ))}
        </div>
      )}

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
