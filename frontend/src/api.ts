// Klien API tipis untuk BlockAgriChain. Menyisipkan JWT dari localStorage,
// dan melempar Error berisi pesan dari backend (termasuk 403 access-denied).

export type Role = 'FARMER' | 'BULOG' | 'KEMENTAN' | 'KEMENKEU' | 'PIHC'

export interface UserInfo {
  id: number; username: string; email: string; role: Role; mspId: string; fabricClientId: string
}
export interface LoginResponse { token: string; expiresAt: string; user: UserInfo }
export interface ChainProof { txId: string; blockNumber: number; blockHash: string }

const TOKEN_KEY = 'bac_token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`/api${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`
    const err = new Error(msg) as Error & { status?: number; accessDenied?: boolean }
    err.status = res.status; err.accessDenied = data?.accessDenied
    throw err
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b),

  login: (username: string, password: string) =>
    req<LoginResponse>('POST', '/auth/login', { username, password }),
  me: () => req<UserInfo>('GET', '/auth/me'),
}

// ── Util format Indonesia ──
export const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
export const fmtRp = (n: number) =>
  'Rp ' + new Intl.NumberFormat('id-ID', { notation: 'compact', compactDisplay: 'short' }).format(n)
export const fmtRpFull = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n)
export const shortTx = (tx?: string) => (tx ? `${tx.slice(0, 8)}…${tx.slice(-4)}` : '—')

// ── Unggah file ke S3 off-chain (presigned PUT) ──
// Backend memberi URL bertanda-tangan; file di-PUT LANGSUNG ke S3 dari browser.
// Mengembalikan URL object (untuk disimpan sebagai *_photo_url, sesuai DPPL).
export interface PresignResp { uploadUrl: string; objectUrl: string; key: string; method: string; contentType: string; s3Ready?: boolean }
export async function uploadToS3(kind: 'harvest' | 'delivery' | 'profile', file: File): Promise<string> {
  const ct = file.type || 'application/octet-stream'
  const p = await api.post<PresignResp>('/uploads/presign', { kind, filename: file.name, contentType: ct })
  const res = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': ct }, body: file })
  if (!res.ok) throw new Error(`Gagal mengunggah ke S3 (HTTP ${res.status})`)
  return p.objectUrl
}

// SHA-256 di sisi klien (untuk hash foto/dokumen sebelum dikirim — sesuai SKPL).
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// SHA-256 dari isi file asli (hash dokumen panen sebenarnya — masuk ledger).
export async function sha256File(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
