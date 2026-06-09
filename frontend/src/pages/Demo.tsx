import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmt, fmtRpFull, shortTx, type ChainProof } from '../api'
import { useAuth } from '../auth'

// Halaman DEMO untuk tugas integrasi smart contract (chaincode) BlockAgriChain.
//  • READ  : state/mapping dari chaincode ditampilkan DINAMIS (bukan hardcoded):
//            - GetActivePolicy (mapping kebijakan subsidi aktif) — butuh sesi login
//            - tinggi blok & statistik ledger (publik) — selalu tampil
//  • WRITE : form ProposePolicy menulis ke blockchain.
//  • CONDITIONAL RENDERING: bila sesi (login) belum aktif → form DIKUNCI (disabled)
//    + banner peringatan; setara "MetaMask belum terhubung" pada DApp Ethereum.

interface Net {
  fabricUp: boolean; blockHeight: number; nodesOnline: number; nodesTotal: number
  stats: { farmers: number; harvests: number; verified: number; activePolicies: number }
}
interface Policy {
  policyId: string; policyName: string; status: string
  ureaCoeff4dp: number; npkCoeff4dp: number; organicCoeff4dp: number
  budgetCapIdrCents: number; effectiveDate: number
  proposedByMspId?: string; approvedByMspId?: string
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 22, border: '1px solid var(--border)' }
const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--txtM)', display: 'block', marginBottom: 5 }
const input: React.CSSProperties = { width: '100%', padding: '10px 13px', borderRadius: 10, border: '1.5px solid var(--border)', fontSize: 14 }

export default function Demo() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [net, setNet] = useState<Net | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [polErr, setPolErr] = useState('')
  const [loadingPol, setLoadingPol] = useState(false)

  const [name, setName] = useState('Subsidi Pupuk 2026')
  const [urea, setUrea] = useState('150')
  const [npk, setNpk] = useState('100')
  const [org, setOrg] = useState('80')
  const [budget, setBudget] = useState('1000000000')
  const [busy, setBusy] = useState(false)
  const [proof, setProof] = useState<ChainProof | null>(null)
  const [msg, setMsg] = useState('')

  const locked = !user                       // sesi belum aktif (≈ MetaMask belum konek)
  const isKementan = user?.role === 'KEMENTAN'

  // READ publik (tanpa login): tinggi blok + statistik ledger — dinamis, refresh 15 dtk.
  useEffect(() => {
    const load = () => fetch('/api/public/network').then(r => r.ok ? r.json() : null).then(d => d && setNet(d)).catch(() => {})
    load(); const t = setInterval(load, 15000); return () => clearInterval(t)
  }, [])

  // READ state kontrak GetActivePolicy (butuh sesi login).
  useEffect(() => {
    if (!user) { setPolicy(null); return }
    setLoadingPol(true); setPolErr('')
    api.get<Policy | null>('/policies/active')
      .then(setPolicy).catch(e => setPolErr((e as Error).message))
      .finally(() => setLoadingPol(false))
  }, [user])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (locked || !isKementan) return
    setBusy(true); setProof(null); setMsg('')
    try {
      const res = await api.post<{ proof: ChainProof }>('/policies/propose', {
        policyName: name, ureaCoeff: Number(urea), npkCoeff: Number(npk),
        organicCoeff: Number(org), budgetCapIdr: Number(budget),
        effectiveDate: new Date().toISOString().slice(0, 10),
      })
      setProof(res.proof)
      setMsg('✓ Berhasil menulis transaksi ProposePolicy ke blockchain.')
    } catch (ex) { setMsg('✕ ' + (ex as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fade" style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <h1 className="page-title">Demo Integrasi Smart Contract (Chaincode)</h1>
      <p className="page-sub">Read &amp; Write data ke Hyperledger Fabric — kontrak <span className="mono">BlockAgriContract</span></p>

      {/* Status sesi (pengganti status MetaMask) */}
      <div style={{
        marginTop: 16, marginBottom: 20, borderRadius: 12, padding: '12px 16px', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', gap: 12,
        background: locked ? '#fef3c7' : '#ecfdf5', border: `1px solid ${locked ? '#fcd34d' : 'var(--g200)'}`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: locked ? '#92400e' : 'var(--g700)' }}>
          {locked ? '🔒 Sesi belum aktif — hubungkan sesi (login) untuk menulis ke blockchain'
                  : `● Sesi aktif sebagai ${user?.role} · MSP ${user?.mspId} · @${user?.username}`}
        </div>
        {locked && <button className="btn" onClick={() => nav('/login')}>Login</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }} className="demo-grid">

        {/* ───── READ: state/mapping dari chaincode (dinamis) ───── */}
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>📖 READ — State Kontrak</div>
          <p style={{ fontSize: 12, color: 'var(--txtS)', margin: '0 0 14px' }}>Diambil langsung dari chaincode/ledger (bukan hardcoded).</p>

          {/* Ledger state publik */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { l: 'Tinggi Blok', v: net ? '#' + fmt(net.blockHeight) : '…' },
              { l: 'Fabric', v: net ? (net.fabricUp ? 'UP' : 'DOWN') : '…' },
              { l: 'Petani', v: net ? fmt(net.stats.farmers) : '…' },
              { l: 'Kebijakan Aktif', v: net ? fmt(net.stats.activePolicies) : '…' },
            ].map(s => (
              <div key={s.l} style={{ background: '#f9fafb', borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--txtS)', fontWeight: 600 }}>{s.l}</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--g700)' }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Mapping GetActivePolicy */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txtM)', marginBottom: 8 }}>
            🔎 <span className="mono">GetActivePolicy()</span> — mapping kebijakan subsidi aktif
          </div>
          {locked ? (
            <div style={{ fontSize: 12.5, color: 'var(--txtS)', background: '#f9fafb', borderRadius: 10, padding: '12px 14px' }}>
              Login untuk membaca state <span className="mono">GetActivePolicy</span> (butuh identitas MSP).
            </div>
          ) : loadingPol ? <div className="muted" style={{ fontSize: 13 }}>Memuat dari chaincode…</div>
          : polErr ? <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{polErr}</div>
          : !policy ? <div className="muted" style={{ fontSize: 13 }}>Belum ada kebijakan aktif di ledger.</div>
          : (
            <div style={{ background: '#f0faf5', border: '1px solid var(--g200)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{policy.policyName}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--g700)', marginBottom: 10 }}>{policy.policyId} · {policy.status}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                {[['Urea', policy.ureaCoeff4dp], ['NPK', policy.npkCoeff4dp], ['Organik', policy.organicCoeff4dp]].map(([l, v]) => (
                  <div key={l as string} style={{ background: '#fff', borderRadius: 9, padding: '8px 4px' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--g700)' }}>{(Number(v) / 10).toFixed(1)}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--txtS)' }}>{l as string} kg/ton</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--txtM)', marginTop: 10 }}>Pagu anggaran: <b>{fmtRpFull(policy.budgetCapIdrCents / 100)}</b></div>
              <div style={{ fontSize: 11, color: 'var(--txtS)', marginTop: 2 }}>Berlaku: {new Date(policy.effectiveDate * 1000).toLocaleDateString('id-ID')} · diusulkan {policy.proposedByMspId} · disetujui {policy.approvedByMspId || '—'}</div>
            </div>
          )}
        </div>

        {/* ───── WRITE: form terkunci bila sesi belum aktif ───── */}
        <div style={{ ...card, position: 'relative' }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>✍️ WRITE — <span className="mono">ProposePolicy()</span></div>
          <p style={{ fontSize: 12, color: 'var(--txtS)', margin: '0 0 14px' }}>Menulis usulan kebijakan baru ke blockchain.</p>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: locked ? 0.55 : 1 }}>
            <div>
              <label style={label}>Nama Kebijakan</label>
              <input style={input} value={name} onChange={e => setName(e.target.value)} disabled={locked || busy} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div><label style={label}>Urea (kg/ton)</label><input style={input} type="number" value={urea} onChange={e => setUrea(e.target.value)} disabled={locked || busy} /></div>
              <div><label style={label}>NPK (kg/ton)</label><input style={input} type="number" value={npk} onChange={e => setNpk(e.target.value)} disabled={locked || busy} /></div>
              <div><label style={label}>Organik</label><input style={input} type="number" value={org} onChange={e => setOrg(e.target.value)} disabled={locked || busy} /></div>
            </div>
            <div>
              <label style={label}>Pagu Anggaran (Rp)</label>
              <input style={input} type="number" value={budget} onChange={e => setBudget(e.target.value)} disabled={locked || busy} />
            </div>
            <button className="btn" disabled={locked || busy || !isKementan} style={{ justifyContent: 'center' }}>
              {busy ? 'Menulis ke blockchain…' : '⛓ Submit ke Blockchain'}
            </button>
            {!locked && !isKementan && (
              <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 12px' }}>
                Form aktif khusus role <b>Kementan</b> (penyusun kebijakan). Login sebagai Kementan untuk menulis.
              </div>
            )}
          </form>

          {msg && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: proof ? 'var(--g700)' : 'var(--red)' }}>{msg}</div>}
          {proof && (
            <div style={{ marginTop: 10, background: 'var(--g900)', color: '#86efac', borderRadius: 10, padding: '12px 14px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
              <div>Bukti On-Chain:</div>
              <div>TxID&nbsp;&nbsp;: {shortTx(proof.txId)}</div>
              <div>Block&nbsp;&nbsp;: #{proof.blockNumber}</div>
              <div>Hash&nbsp;&nbsp;&nbsp;: {shortTx(proof.blockHash)}</div>
            </div>
          )}

          {/* Overlay gembok bila sesi belum aktif */}
          {locked && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(1px)' }}>
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', boxShadow: '0 10px 30px rgba(0,0,0,.12)', textAlign: 'center' }}>
                <div style={{ fontSize: 22 }}>🔒</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>Form terkunci</div>
                <div style={{ fontSize: 11.5, color: 'var(--txtS)' }}>Sesi belum aktif</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@media(max-width:760px){.demo-grid{grid-template-columns:1fr!important}}`}</style>
    </div>
  )
}
