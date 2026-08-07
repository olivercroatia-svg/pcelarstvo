import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  showSuccess: (message: string) => void
  showError: (message: string) => void
  showWarning: (message: string) => void
  showInfo: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const STYLES: Record<ToastKind, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-ok/40 text-ok' },
  error: { icon: XCircle, className: 'border-critical/40 text-critical' },
  warning: { icon: TriangleAlert, className: 'border-warning/40 text-warning' },
  info: { icon: Info, className: 'border-info/40 text-info' },
}

const DURATION_MS = 5000

/**
 * Transient messages. Errors stay until dismissed — a failed save that vanishes after four seconds
 * is how a beekeeper loses an inspection without noticing.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, kind, message }])
      if (kind !== 'error') {
        setTimeout(() => dismiss(id), DURATION_MS)
      }
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      showSuccess: (m) => push('success', m),
      showError: (m) => push('error', m),
      showWarning: (m) => push('warning', m),
      showInfo: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext value={api}>
      {children}
      {/* Bottom-anchored above the nav bar: the top of a phone screen is the hardest place to
          reach one-handed, and that is where the thumb has to go to dismiss. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 pb-safe"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = STYLES[toast.kind]
          return (
            <div
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-card p-3 shadow-lg',
                className,
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p className="flex-1 text-sm text-card-foreground">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Zatvori obavijest"
                className="-m-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
