import { api } from '../api'
import { useApi } from '../hooks'
import { useAuth } from '../auth'
import { Badge, Empty, useToast } from '../ui'

interface FarmerRow {
  id: number; fullName: string; farmerGroup: string; phone: string; farmerChainId: string
  isActive: boolean; province: string | null
}

export default function Farmers() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, reload } = useApi<FarmerRow[]>('/farmers')
  const isKementan = user?.role === 'KEMENTAN'

  const disable = async (id: number) => {
    if (!confirm('Nonaktifkan akun petani ini? (soft-delete on-chain)')) return
    try { await api.post(`/farmers/${id}/disable`); toast('Petani dinonaktifkan on-chain'); reload() }
    catch (ex) { toast((ex as Error).message, 'error') }
  }

  return (
    <div className="fade">
      <h1 className="page-title">Data Petani</h1>
      <p className="page-sub">Identitas on-chain (fabric_client_id) · NIK asli tidak ditampilkan (privasi)</p>

      <div className="card" style={{ marginTop: 18, padding: 0 }}>
        <table>
          <thead><tr><th>ID On-Chain</th><th>Nama</th><th>Kelompok</th><th>Provinsi</th><th>Status</th>{isKementan && <th>Aksi</th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><Empty text="Memuat…" /></td></tr>}
            {data?.map(f => (
              <tr key={f.id}>
                <td className="mono">{f.farmerChainId}</td>
                <td>{f.fullName}</td>
                <td>{f.farmerGroup}</td>
                <td>{f.province ?? '—'}</td>
                <td><Badge status={f.isActive ? 'ACTIVE' : 'SUPERSEDED'} /></td>
                {isKementan && <td>{f.isActive && <button className="btn sm danger" onClick={() => disable(f.id)}>Nonaktifkan</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
