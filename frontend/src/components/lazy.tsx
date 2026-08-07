import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/ui/states'

/**
 * The three heavy dependencies, split out of the main bundle.
 *
 * Together ZXing, Leaflet and qrcode are most of the download, and none of them is needed to open
 * the app, look at the dashboard or record an inspection — the things a beekeeper does on a weak
 * connection. Keeping them in the entry chunk would make the first load of a field app pay for
 * features it may never use in that session.
 */

const LazyLocationPicker = lazy(() =>
  import('./LocationPicker').then((m) => ({ default: m.LocationPicker })),
)

export function LocationPicker(props: ComponentProps<typeof LazyLocationPicker>) {
  return (
    <Suspense fallback={<div className="h-56 w-full animate-pulse rounded-xl bg-muted" />}>
      <LazyLocationPicker {...props} />
    </Suspense>
  )
}

const LazyQrCode = lazy(() => import('./QrCode').then((m) => ({ default: m.QrCode })))

export function QrCode(props: ComponentProps<typeof LazyQrCode>) {
  const size = props.size ?? 160
  return (
    <Suspense fallback={<div className="animate-pulse rounded bg-muted" style={{ width: size, height: size }} />}>
      <LazyQrCode {...props} />
    </Suspense>
  )
}

/**
 * Suspense covers the wait, not the failure.
 *
 * Every page is its own chunk, so any navigation can reach for the network — and a beekeeper taps
 * one on a hillside on whatever signal is left, or in the minute after a deploy while the open tab
 * still asks for chunk names that no longer exist. A rejected import throws straight past Suspense,
 * React unmounts the tree, and the app becomes a white screen. React also caches that rejection on
 * the lazy component, so coming back to the route re-throws it; a reload is the only real recovery,
 * which is what the button does.
 *
 * A class is not a style choice here — `getDerivedStateFromError` has no hook equivalent, and this
 * is the one component in the app that needs it.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Ruta se nije učitala', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <ErrorState
        message="Ovaj dio aplikacije nije se uspio učitati. Provjerite vezu pa pokušajte ponovno."
        onRetry={() => window.location.reload()}
      />
    )
  }
}

export function LazyRoute({ children }: { children: ReactNode }) {
  // Keyed on the path so a boundary that caught one screen does not keep the next one from trying:
  // the shell's Outlet stays mounted across navigations, and without this the error card would
  // outlive the route that produced it.
  const { pathname } = useLocation()
  return (
    <RouteErrorBoundary key={pathname}>
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}
