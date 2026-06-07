import { useState } from 'react'
import { api, shortTx } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Empty, useToast } from '../ui'

interface Block {
  blockNumber: number; txId: string; functionName: string; key: string
  mspId: string; clientId: string; timestamp: string; hash: string; prevHash: string
}
interface Integrity { intact: boolean; totalBlocks: number; brokenBlocks: number; firstBrokenBlock: number | null; headHash: string }

export default function Explorer() {
  const { user } = useAuth()
  const toast = useToast()
  const isKemenkeu = user?.role === 'KEMENKEU'
  const { data: blocks, loading } = useApi<Block[]>('/ledger/blocks?take=100')
  const [integrity, setIntegrity] = useState<Integrity | null>(null)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    try { setIntegrity(await api.get<Integrity>('/ledger/integrity')); toast('Verifikasi integritas rantai selesai') }
    catch (ex) { toast((ex as Error).message, 'error') } finally { setChecking(false) }
  }

  return (
    <div className="fade">
      <div className="between">
        <div>
          <h1 className="page-title">{isKemenkeu ? 'Audit Trail Blockchain' : 'Blockchain Explorer'}</h1>
          <p className="page-sub">Semua transaksi tercatat permanen di Immutable Ledger — tidak dapat diubah</p>
        </div>
        <button className="btn" onClick={check} disabled={checking}>{checking ? 'Memeriksa…' : '🛡️ Verifikasi Integritas'}</button>
      </div>

      {integrity && (
        <div className="card" style={{ marginTop: 16, borderColor: integrity.intact ? 'var(--g200)' : 'var(--red)' }}>
          <div style={{ fontWeight: 700, color: integrity.intact ? 'var(--g600)' : 'var(--red)' }}>
            {integrity.intact ? '✓ Rantai UTUH' : '✕ Rantai RUSAK'} — {integrity.totalBlocks} blok diperiksa
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {integrity.intact
              ? `Setiap hash cocok & terhubung ke blok sebelumnya. Head: ${shortTx(integrity.headHash)}`
              : `${integrity.brokenBlocks} blok termanipulasi (mulai blok #${integrity.firstBrokenBlock}).`}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {loading && <Empty text="Memuat ledger…" />}
        {!loading && (blocks?.length ?? 0) === 0 && <Empty text="Belum ada transaksi" />}
        {blocks?.map((b, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 66, height: 38, background: 'var(--g900)', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)' }}>BLOCK</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#86efac' }}>#{b.blockNumber}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)' }}>{b.functionName || '—'}</span>
                <span style={{ fontSize: 10, background: 'var(--blueL)', color: 'var(--blue)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{b.mspId || 'MSP'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--txtS)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.key}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--txtS)', fontFamily: 'monospace' }}>{(b.timestamp ?? '').replace('T', ' ').slice(0, 19)}</div>
              <div style={{ fontSize: 9, color: 'var(--g500)', fontFamily: 'monospace', marginTop: 2 }}>Hash: {shortTx(b.hash)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
