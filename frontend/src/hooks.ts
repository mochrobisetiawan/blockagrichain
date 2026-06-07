import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/// Hook GET sederhana dengan state loading/error + refetch.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!path) { setLoading(false); return }
    setLoading(true)
    api.get<T>(path)
      .then(d => { setData(d); setError('') })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [path])

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}
