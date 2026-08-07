import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from './button'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

/**
 * Promise-based replacement for window.confirm — the native dialog ignores the brand entirely and
 * is blocked outright in some in-app browsers, which would silently turn "are you sure?" into
 * "nothing happened".
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  const settle = useCallback(
    (value: boolean) => {
      setPending((current) => {
        current?.resolve(value)
        return null
      })
    },
    [],
  )

  useEffect(() => {
    if (!pending) return
    confirmButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pending, settle])

  return (
    <ConfirmContext value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          // Clicking the backdrop cancels; clicking the panel must not bubble up to it.
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={pending.description ? 'confirm-description' : undefined}
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-title" className="text-lg font-semibold">
              {pending.title}
            </h2>
            {pending.description && (
              <p id="confirm-description" className="mt-2 text-sm text-muted-foreground">
                {pending.description}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => settle(false)}>
                {pending.cancelLabel ?? 'Odustani'}
              </Button>
              <Button
                ref={confirmButtonRef}
                variant={pending.destructive ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? 'Potvrdi'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
