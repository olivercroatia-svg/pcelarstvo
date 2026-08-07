import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from './api'
import { db, type OutboxItem, type OutboxKind } from './db'
import { belongsToScope, type OutboxScope } from './outboxScope'

interface OutboxApi {
  pending: OutboxItem[]
  online: boolean
  syncing: boolean
  /** Queues the write and tries to send it straight away. Resolves once it is safely stored. */
  enqueue: (item: { id: string; kind: OutboxKind; path: string; payload: unknown; label: string }) => Promise<void>
  flush: () => Promise<void>
  discard: (id: string) => Promise<void>
}

const OutboxContext = createContext<OutboxApi | null>(null)

/** Statuses that will never succeed on retry — keeping them would block the queue forever. */
const PERMANENT = new Set([400, 403, 404, 409, 413, 422])

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { current } = useAuth()
  const [pending, setPending] = useState<OutboxItem[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const running = useRef(false)
  const userId = current?.user.id ?? null
  const farmId = current?.farm?.id ?? null
  const scope = useMemo<OutboxScope | null>(
    () => (userId && farmId ? { userId, farmId } : null),
    [userId, farmId],
  )
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const scopedItems = useCallback(async () => {
    if (!scope) return []
    const items = await db.outbox
      .where('[userId+farmId]')
      .equals([scope.userId, scope.farmId])
      .sortBy('createdAt')
    return items.filter((item) => belongsToScope(item, scope))
  }, [scope])

  const refresh = useCallback(async () => {
    const items = await scopedItems()
    const activeScope = scopeRef.current
    if (
      (scope === null && activeScope === null) ||
      (scope !== null &&
        activeScope?.userId === scope.userId &&
        activeScope.farmId === scope.farmId)
    ) {
      setPending(items)
    }
  }, [scope, scopedItems])

  const flush = useCallback(async () => {
    // A second flush while one is in flight would send the same item twice. Harmless thanks to
    // server-side idempotency, but it doubles traffic on exactly the connection that is struggling.
    if (running.current || !navigator.onLine || !scope) return
    running.current = true
    setSyncing(true)

    try {
      for (const item of await scopedItems()) {
        const activeScope = scopeRef.current
        if (!activeScope || !belongsToScope(item, activeScope)) break
        try {
          await api(item.path, { method: 'POST', body: item.payload })
          await db.outbox.delete(item.id)
        } catch (err) {
          const status = err instanceof ApiError ? err.status : 0
          const message = err instanceof ApiError ? err.message : 'Nepoznata pogreška'

          if (status === 0 || status === 401 || status >= 500) {
            // Offline, session not restored yet, or the server is down — keep it and stop; the
            // rest of the queue will fail the same way.
            await db.outbox.update(item.id, {
              attempts: item.attempts + 1,
              lastError: message,
            })
            break
          }

          if (PERMANENT.has(status)) {
            // Rejected on its merits. Held with the error visible rather than silently dropped —
            // the beekeeper needs to know that entry never landed.
            await db.outbox.update(item.id, {
              attempts: item.attempts + 1,
              lastError: message,
            })
            continue
          }
        }
      }
    } finally {
      running.current = false
      setSyncing(false)
      await refresh()
    }
  }, [refresh, scope, scopedItems])

  const enqueue = useCallback<OutboxApi['enqueue']>(
    async (item) => {
      if (!scope) throw new Error('Offline zapis zahtijeva prijavljenog korisnika i gospodarstvo')
      await db.outbox.put({ ...item, ...scope, createdAt: Date.now(), attempts: 0, lastError: null })
      await refresh()
      void flush()
    },
    [flush, refresh, scope],
  )

  const discard = useCallback(
    async (id: string) => {
      const item = await db.outbox.get(id)
      if (item && scope && belongsToScope(item, scope)) await db.outbox.delete(id)
      await refresh()
    },
    [refresh, scope],
  )

  useEffect(() => {
    void refresh().then(() => flush())

    const goOnline = () => {
      setOnline(true)
      void flush()
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    // The `online` event does not fire when a phone regains signal on the same Wi-Fi/cell it never
    // formally left, so a slow tick catches what the event misses.
    const timer = setInterval(() => void flush(), 60_000)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      clearInterval(timer)
    }
  }, [flush, refresh])

  const visiblePending = useMemo(
    () => (scope ? pending.filter((item) => belongsToScope(item, scope)) : []),
    [pending, scope],
  )

  const value = useMemo<OutboxApi>(
    () => ({ pending: visiblePending, online, syncing, enqueue, flush, discard }),
    [visiblePending, online, syncing, enqueue, flush, discard],
  )

  return <OutboxContext value={value}>{children}</OutboxContext>
}

export function useOutbox(): OutboxApi {
  const ctx = useContext(OutboxContext)
  if (!ctx) throw new Error('useOutbox must be used inside <OutboxProvider>')
  return ctx
}
