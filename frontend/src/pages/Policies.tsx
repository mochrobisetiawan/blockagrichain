import { useState } from 'react'
import { api, fmtRp } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast, usePaged } from '../ui'

const C = { g700: '#1a5e38', blue: '#2563eb', purple: '#7c3aed' }

interface Policy {
  id: number; policyName: string; ureaCoeff: number; npkCoeff: number; organicCoeff: number
  budgetCapIdr: number; status: string; policyChainId: string; effectiveDate: string
}

export default function Policies() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, reload } = useApi<Policy[]>('/policies')
  const { pageItems, pager } = usePaged(data, 6)
  const [form, setForm] = useState({ name: '', urea: '50', npk: '35', organic: '24', budget: '6000000000000', date: '2026-07-01' })
  const [busy, setBusy] = useState(false)

  const isKementan = user?.role === 'KEMENTAN'
  const isKemenkeu = user?.role === 'KEMENKEU'

  const propose = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await api.post('/policies/propose', {
        policyName: form.name, ureaCoeff: Number(form.urea), npkCoeff: Number(form.npk),
        organicCoeff: Number(form.organic), budgetCapIdr: Number(form.budget), effectiveDate: form.date,
      })
      toast('Kebijakan diusulkan ke Kemenkeu (PENDING_APPROVAL)')
      setForm({ ...form, name: '' }); reload()
    } catch (ex) { toast((ex as Error).message, 'error') } finally { setBusy(false) }
  }
  const approve = async (id: number) => {
    try { await api.post(`/policies/${id}/approve`); toast('Kebijakan diaktifkan on-chain'); reload() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }

  return (
    <div className="fade">
      <h1 className="page-title">{isKemenkeu ? 'Persetujuan Kebijakan' : 'Kelola Kebijakan Subsidi'}</h1>
      <p className="page-sub">Alur dua langkah: Kementan usulkan → Kemenkeu setujui & aktifkan</p>

      {isKementan && (
        <form className="card" style={{ marginTop: 18 }} onSubmit={propose}>
          <h3>Usulkan Kebijakan Baru</h3>
          <div className="field"><label>Nama Kebijakan</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Kebijakan Subsidi Q3 2026" /></div>
          <div className="grid cols-4">
            <div className="field"><label>Koef. Urea (kg/ton)</label><input type="number" value={form.urea} onChange={e => setForm({ ...form, urea: e.target.value })} /></div>
            <div className="field"><label>Koef. NPK (kg/ton)</label><input type="number" value={form.npk} onChange={e => setForm({ ...form, npk: e.target.value })} /></div>
            <div className="field"><label>Koef. Organik (kg/ton)</label><input type="number" value={form.organic} onChange={e => setForm({ ...form, organic: e.target.value })} /></div>
            <div className="field"><label>Tgl Berlaku</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
          </div>
          <div className="field"><label>Budget Cap (IDR)</label><input type="number" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} /></div>
          <button className="btn" disabled={busy}>{busy ? 'Mengusulkan…' : '📜 Usulkan Kebijakan'}</button>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
        {loading && <Empty text="Memuat…" />}
        {!loading && (data?.length ?? 0) === 0 && <Empty text="Belum ada kebijakan" />}
        {pageItems.map(p => (
          <div key={p.id} style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{p.policyName}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--txtS)' }}>{p.policyChainId} · Berlaku: {(p.effectiveDate ?? '').slice(0, 10)}</div>
              </div>
              <Badge status={p.status} />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {([['Koef. Urea', `${p.ureaCoeff} kg/ton`, C.g700], ['Koef. NPK', `${p.npkCoeff} kg/ton`, C.blue], ['Koef. Organik', `${p.organicCoeff} kg/ton`, C.g700], ['Budget Cap', fmtRp(p.budgetCapIdr), C.purple]] as [string, string, string][]).map(([k, v, c]) => (
                <div key={k} style={{ background: '#f9fafb', borderRadius: 10, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ fontSize: 10, color: 'var(--txtS)', marginBottom: 3 }}>{k}</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            {isKemenkeu && p.status === 'PENDING_APPROVAL' && (
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => approve(p.id)}>✓ Setujui & Aktifkan On-Chain</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {pager}
    </div>
  )
}
