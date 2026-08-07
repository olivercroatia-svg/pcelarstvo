import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

interface ResourceState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => Promise<void>
  setData: (next: T) => void
}

/**
 * Minimal GET-and-refetch hook.
 *
 * Deliberately not TanStack Query: the screens here need "load, show, refetch after a mutation"
 * and nothing more, and a cache layer would be a second source of truth to reason about for no
 * gain yet. If a later stage needs shared caching across routes, that is the moment to introduce
 * it rather than now.
 */
export function useResource<T>(path: string | null): ResourceState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)

  // Guards against a slow response for a previous path overwriting a newer one, which shows up as
  // the wrong hive's card after tapping through a list quickly.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (path === null) {
      setData(null)
      setLoading(false)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = await api<T>(path)
      if (id === requestId.current) setData(result)
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof ApiError ? err.message : 'Podatke nije moguće učitati')
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  return { data, error, loading, reload: load, setData }
}
