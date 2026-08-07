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
import { api, ApiError } from './api'
import { db, type OutboxItem, type OutboxKind } from './db'

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
  const [pending, setPending] = useState<OutboxItem[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const running = useRef(false)

  const refresh = useCallback(async () => {
    setPending(await db.outbox.orderBy('createdAt').toArray())
  }, [])

  const flush = useCallback(async () => {
    // A second flush while one is in flight would send the same item twice. Harmless thanks to
    // server-side idempotency, but it doubles traffic on exactly the connection that is struggling.
    if (running.current || !navigator.onLine) return
    running.current = true
    setSyncing(true)

    try {
      for (const item of await db.outbox.orderBy('createdAt').toArray()) {
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
  }, [refresh])

  const enqueue = useCallback<OutboxApi['enqueue']>(
    async (item) => {
      await db.outbox.put({ ...item, createdAt: Date.now(), attempts: 0, lastError: null })
      await refresh()
      void flush()
    },
    [flush, refresh],
  )

  const discard = useCallback(
    async (id: string) => {
      await db.outbox.delete(id)
      await refresh()
    },
    [refresh],
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

  const value = useMemo<OutboxApi>(
    () => ({ pending, online, syncing, enqueue, flush, discard }),
    [pending, online, syncing, enqueue, flush, discard],
  )

  return <OutboxContext value={value}>{children}</OutboxContext>
}

export function useOutbox(): OutboxApi {
  const ctx = useContext(OutboxContext)
  if (!ctx) throw new Error('useOutbox must be used inside <OutboxProvider>')
  return ctx
}
