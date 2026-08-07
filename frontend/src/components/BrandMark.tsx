import { cn } from '@/lib/utils'

/** Hexagon-and-bee mark from §2 — the honeycomb cell doubles as the app icon silhouette. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('text-primary', className)} aria-hidden role="presentation">
      <path
        d="M24 3.5 41.7 13.75v20.5L24 44.5 6.3 34.25v-20.5z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* bee body */}
      <ellipse cx="24" cy="26" rx="5.5" ry="7.5" fill="currentColor" />
      <path d="M18.7 23.5h10.6M18.9 28h10.2" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" />
      {/* wings */}
      <ellipse cx="16.5" cy="19.5" rx="4.6" ry="3" fill="currentColor" fillOpacity="0.45" transform="rotate(-28 16.5 19.5)" />
      <ellipse cx="31.5" cy="19.5" rx="4.6" ry="3" fill="currentColor" fillOpacity="0.45" transform="rotate(28 31.5 19.5)" />
    </svg>
  )
}
