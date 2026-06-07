import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken, type UserInfo } from './api'

interface AuthCtx {
  user: UserInfo | null
  loading: boolean
  login: (u: string, p: string) => Promise<void>
  logout: () => void
}
const Ctx = createContext<AuthCtx>(null!)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setLoading(false))
  }, [])

  const login = async (u: string, p: string) => {
    const res = await api.login(u, p)
    setToken(res.token)
    setUser(res.user)
  }
  const logout = () => { setToken(null); setUser(null) }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}
