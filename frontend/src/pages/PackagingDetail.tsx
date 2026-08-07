import { ArrowLeft, Copy, Eye, EyeOff, FileText, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { QrCode } from '@/components/lazy'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { CheckRow } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { NationalReadiness, PackagingRun } from '@/lib/types'
import { jarUrl } from '@/lib/urls'
import { useResource } from '@/lib/useResource'

/** §33 packaging run, §35 its public page, §36 the national-jar checklist. */
export function PackagingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { current } = useAuth()

  const { data, error, loading, reload } = useResource<{ packaging: PackagingRun }>(`/packaging/${id}`)
  const { data: national, reload: reloadNational } = useResource<NationalReadiness>(`/packaging/${id}/national`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const run = data.packaging
  const isOwner = current?.role === 'owner'

  async function publish() {
    try {
      await api(`/packaging/${id}/publish`, { method: 'POST', body: {} })
      showSuccess('Javna stranica je objavljena')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Objava nije uspjela')
    }
  }

  async function unpublish() {
    const ok = await confirm({
      title: 'Ukloni javnu stranicu',
      description:
        'Već otisnuti QR kodovi prestat će raditi. Ponovna objava stvara novu adresu, ne vraća staru.',
      confirmLabel: 'Ukloni',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/packaging/${id}/publish`, { method: 'DELETE' })
      showSuccess('Javna stranica je uklonjena')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Uklanjanje nije uspjelo')
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Brisanje pakiranja',
      description: `Med (${formatNumber(run.totalKg)} kg) vraća se u seriju ${run.lotCode}.`,
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/packaging/${id}`, { method: 'DELETE' })
      showSuccess('Pakiranje je obrisano, med je vraćen u seriju')
      navigate(`/serije/${run.batchId}`, { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  async function toggleNational(next: boolean) {
    try {
      await api(`/packaging/${id}`, { method: 'PATCH', body: { isNational: next } })
      await Promise.all([reload(), reloadNational()])
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to={`/serije/${run.batchId}`}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="tabular min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">
          {run.jarCount} × {run.jarSizeG} g
        </h1>
      </div>

      <Card>
        <CardContent className="py-3">
          <dl className="space-y-1.5 text-sm">
            <Row label="Serija" value={run.lotCode} />
            <Row label="Proizvod" value={run.productName} />
            <Row label="Pakirano" value={formatDate(run.packagedOn)} />
            <Row label="Količina" value={`${formatNumber(run.totalKg)} kg`} />
            {/* §37 — a run is a stock of jars, not only a record that they were filled. */}
            <Row
              label="Prodano"
              value={run.soldCount > 0 ? `${run.soldCount} od ${run.jarCount}` : 'nijedna staklenka'}
            />
            <Row
              label="Na skladištu"
              value={`${run.remainingCount} ${run.remainingCount === 1 ? 'staklenka' : 'staklenki'} · ${formatNumber(run.remainingKg)} kg`}
            />
            <Row label="Najbolje upotrijebiti do" value={run.bestBefore ? formatDate(run.bestBefore) : null} />
            {run.isNational && (
              <Row
                label="Serijski brojevi"
                value={run.serialFrom ? `${run.serialFrom}${run.serialTo ? ` – ${run.serialTo}` : ''}` : null}
              />
            )}
          </dl>
        </CardContent>
      </Card>

      <Link
        to={`/pakiranja/${run.id}/deklaracija`}
        className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
      >
        <FileText className="size-5" />
        Deklaracija
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nacionalna staklenka</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={run.isNational}
              onChange={(e) => toggleNational(e.target.checked)}
              className="size-5 rounded border-input accent-primary"
            />
            Pakiranje ide u nacionalnu staklenku
          </label>

          {run.isNational && national && (
            <>
              <ul>
                {national.checks.map((c) => (
                  <CheckRow key={c.key} label={c.label} ok={c.ok} detail={c.detail} />
                ))}
              </ul>
              <p className={national.ready ? 'text-sm font-medium text-ok' : 'text-sm text-caution'}>
                {national.ready
                  ? 'Sve stavke su ispunjene.'
                  : 'Nedostaju stavke označene upozorenjem.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Javna stranica (QR na staklenci)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {run.publicToken ? (
            <>
              {/* Always on white: a QR code inverted by dark mode does not scan. */}
              <div className="flex flex-col items-center gap-2 rounded-lg bg-white p-3">
                <QrCode value={jarUrl(run.publicToken)} size={160} />
                <p className="break-all text-center text-xs text-neutral-600">{jarUrl(run.publicToken)}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(jarUrl(run.publicToken!))
                      .then(() => showSuccess('Adresa je kopirana'))
                      .catch(() => showError('Kopiranje nije uspjelo'))
                  }}
                >
                  <Copy />
                  Kopiraj adresu
                </Button>
                <a
                  href={jarUrl(run.publicToken)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
                >
                  <Eye className="size-4" />
                  Pogledaj
                </a>
              </div>
              {isOwner && (
                <Button variant="outline" className="w-full text-destructive" onClick={unpublish}>
                  <EyeOff />
                  Ukloni javnu stranicu
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Kupac skeniranjem vidi vrstu meda, pčelara, mjesto, pašu, LOT i je li obavljen
                laboratorijski pregled. Adresa, OIB i lokacija pčelinjaka se ne prikazuju.
              </p>
              {isOwner ? (
                <Button className="w-full" onClick={publish}>
                  <Eye />
                  Objavi javnu stranicu
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Objaviti je može samo vlasnik gospodarstva.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {isOwner &&
        // Hidden once a jar has been sold. The server refuses it anyway (409) — deleting the run
        // would return honey to the LOT that is already in a customer's kitchen — so offering the
        // button would only be offering a dead end.
        (run.soldCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Pakiranje se ne može obrisati jer je iz njega prodano {run.soldCount}{' '}
            {run.soldCount === 1 ? 'staklenka' : 'staklenki'}. Prvo obrišite te prodaje.
          </p>
        ) : (
          <Button variant="outline" className="w-full text-destructive" onClick={remove}>
            <Trash2 />
            Obriši pakiranje
          </Button>
        ))}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value ?? '—'}</dd>
    </div>
  )
}
