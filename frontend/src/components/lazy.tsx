import { lazy, Suspense, type ComponentProps } from 'react'
import { LoadingState } from '@/components/ui/states'

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

export function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingState />}>{children}</Suspense>
}
