import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError } from '@/lib/api'

export interface CurrentUser {
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    phone: string | null
    isAdmin: boolean
  }
  farm: {
    id: string
    entityType: string
    name: string | null
    oib: string | null
    mibpg: string | null
    responsiblePerson: string | null
    address: string | null
    city: string | null
    postalCode: string | null
    eppNumber: string | null
    apiaryCount: number | null
    colonyCount: number | null
    association: string | null
    pastureCommissioner: string | null
  } | null
  role: 'owner' | 'worker' | null
  completeness: { percent: number; missing: { key: string; label: string }[] }
}

interface AuthContextValue {
  current: CurrentUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (payload: Record<string, unknown>) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  /** True for the farm owner; workers may record work but not change the business (§4). */
  isOwner: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setCurrent(await api<CurrentUser>('/me'))
    } catch (err) {
      // 401 on boot is the normal "not signed in" case, not a failure worth surfacing.
      if (!(err instanceof ApiError && err.status === 401)) console.error(err)
      setCurrent(null)
    }
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    setCurrent(await api<CurrentUser>('/auth/login', { method: 'POST', body: { email, password } }))
  }, [])

  const register = useCallback(async (payload: Record<string, unknown>) => {
    setCurrent(await api<CurrentUser>('/auth/register', { method: 'POST', body: payload }))
  }, [])

  const logout = useCallback(async () => {
    await api<void>('/auth/logout', { method: 'POST' })
    setCurrent(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ current, loading, login, register, logout, refresh, isOwner: current?.role === 'owner' }),
    [current, loading, login, register, logout, refresh],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
