import { ArrowLeft, Printer } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { QrCode } from '@/components/lazy'
import { hiveScanUrl } from '@/lib/urls'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import type { Hive } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * §11 — a printable sheet of QR labels.
 *
 * Print styles rather than a generated PDF: the labels have to come out at a known physical size
 * on whatever sticker paper the beekeeper already has, and the browser's own print dialog handles
 * that better than a server-rendered A4 we would have to guess the margins for.
 */
export function HiveLabelsPage() {
  const [params] = useSearchParams()
  const apiaryId = params.get('pcelinjak')

  const { data, error, loading } = useResource<{ hives: Hive[] }>(
    `/hives${apiaryId ? `?apiaryId=${apiaryId}` : ''}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const hives = data?.hives ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Link to="/kosnice" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Naljepnice</h1>
        <Button onClick={() => window.print()}>
          <Printer />
          Ispiši
        </Button>
      </div>

      <p className="text-sm text-muted-foreground print:hidden">
        {hives.length} {hives.length === 1 ? 'naljepnica' : 'naljepnica'}. Ispišite na naljepnice ili
        običan papir i zalijepite na košnice — svaka naljepnica otvara karton svoje košnice.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {hives.map((hive) => (
          <div
            key={hive.id}
            className="flex flex-col items-center gap-1 rounded-lg border border-border bg-white p-3 text-center print:break-inside-avoid print:rounded-none"
          >
            <QrCode value={hiveScanUrl(hive.qrToken)} size={110} />
            <span className="text-lg font-bold leading-none text-[#201e1d]">{hive.code}</span>
            <span className="flex items-center gap-1 text-[10px] leading-none text-[#6b5c47]">
              <BrandMark className="size-3" />
              Moj Pčelinjak
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
