import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ChainProof } from './api'
import { shortTx } from './api'

// ── Status badge (peta warna & label ID dari prototype) ──
const BADGE: Record<string, { bg: string; c: string; l: string }> = {
  PENDING: { bg: '#fef3c7', c: '#92400e', l: 'Menunggu' },
  VERIFIED: { bg: '#dcfce7', c: '#166534', l: 'Terverifikasi' },
  APPROVED: { bg: '#dcfce7', c: '#166534', l: 'Disetujui' },
  REJECTED: { bg: '#fee2e2', c: '#991b1b', l: 'Ditolak' },
  CREATED: { bg: '#f3f4f6', c: '#374151', l: 'Dibuat' },
  SHIPPED: { bg: '#dbeafe', c: '#1e40af', l: 'Dikirim' },
  DELIVERED: { bg: '#dcfce7', c: '#166534', l: 'Terkirim' },
  CONFIRMED: { bg: '#dcfce7', c: '#166534', l: 'Dikonfirmasi' },
  REQUESTED: { bg: '#fef3c7', c: '#92400e', l: 'Diajukan' },
  DISBURSED: { bg: '#ede9fe', c: '#6d28d9', l: 'Dicairkan' },
  PENDING_APPROVAL: { bg: '#fef3c7', c: '#92400e', l: 'Menunggu Persetujuan' },
  ACTIVE: { bg: '#dcfce7', c: '#166534', l: 'Aktif' },
  SUPERSEDED: { bg: '#f3f4f6', c: '#6b7280', l: 'Digantikan' },
  DRAFT: { bg: '#f3f4f6', c: '#374151', l: 'Draft' },
}
export function Badge({ status }: { status: string }) {
  const b = BADGE[status] ?? { bg: '#f3f4f6', c: '#374151', l: status }
  return <span className="badge" style={{ background: b.bg, color: b.c }}>{b.l}</span>
}

// ── Logo ──
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d="M50 28L30 39v22l20 11 20-11V39L50 28z" fill="none" stroke="#fff" strokeWidth="6" strokeLinejoin="round" />
      <path d="M50 39v22M30 39l20 11 20-11" fill="none" stroke="#86efac" strokeWidth="4" />
    </svg>
  )
}

// ── Bukti blockchain (Blockchain Evidence) ──
export function ChainProofBox({ proof }: { proof: ChainProof }) {
  return (
    <div className="chain-proof">
      <div>🔗 <b>Bukti Blockchain</b></div>
      <div style={{ marginTop: 6 }}>Fabric TxID: {proof.txId}</div>
      <div>Block #{proof.blockNumber}</div>
      <div>Block Hash: {shortTx(proof.blockHash)}</div>
    </div>
  )
}

// ── Toast ──
type Toast = { id: number; msg: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = (msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems(s => [...s, { id, msg, kind }])
    setTimeout(() => setItems(s => s.filter(t => t.id !== id)), 4200)
  }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map(t => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="muted" style={{ padding: '28px 8px', textAlign: 'center' }}>{text}</div>
}

// ── Pagination reusable untuk semua list/tabel ──
// Pakai: const { pageItems, pager } = usePaged(data, 8); lalu render pageItems + {pager}
export function usePaged<T>(items: T[] | undefined | null, per = 8) {
  const [page, setPage] = useState(0)
  const list = items ?? []
  const total = list.length
  const pageCount = Math.max(1, Math.ceil(total / per))
  const p = Math.min(page, pageCount - 1)
  const pageItems = list.slice(p * per, p * per + per)
  const pager = total <= per ? null : (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', flexWrap: 'wrap', gap: 8 }}>
      <span className="muted" style={{ fontSize: 12 }}>Menampilkan {p * per + 1}–{Math.min((p + 1) * per, total)} dari {total}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn sm secondary" disabled={p === 0} onClick={() => setPage(p - 1)}>← Sebelumnya</button>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{p + 1}/{pageCount}</span>
        <button className="btn sm secondary" disabled={p >= pageCount - 1} onClick={() => setPage(p + 1)}>Berikutnya →</button>
      </div>
    </div>
  )
  return { pageItems, pager, page: p, setPage, total }
}

// Stat card — gaya prototype BlockAgriChain (ikon + warna aksen + sub).
export function Stat({ label, value, sub, color = 'var(--g700)', icon }:
  { label: string; value: ReactNode; sub?: string; color?: string; icon?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid var(--border)', flex: '1 1 150px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--txtS)', fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--txtS)', marginTop: 4 }}>{sub}</div>}
        </div>
        {icon && <div style={{ width: 38, height: 38, borderRadius: 10, background: typeof color === 'string' && color.startsWith('#') ? color + '18' : 'var(--g100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{icon}</div>}
      </div>
    </div>
  )
}
