import { ArrowLeft, Boxes, Crown, FlaskConical, Grid2x2, Package, Printer, Search, Syringe } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { WithdrawalWarning } from '@/components/WithdrawalWarning'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate, formatNumber, plural } from '@/lib/format'
import type { TraceabilityChain } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * §30 — "staklenka → LOT → vrcanje → pčelinjak → košnice", read from a LOT code a customer read
 * off a jar over the phone.
 *
 * Laid out as a chain rather than a set of cards because that is the question being asked: not
 * "what do we know about this batch" but "where did this jar come from". Each link points at the
 * record behind it, so the answer to a customer's question is three taps rather than three screens.
 */
export function TraceabilityPage() {
  const { key } = useParams<{ key: string }>()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { data, error, loading } = useResource<TraceabilityChain>(key ? `/traceability/${key}` : null)

  if (!key) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Sljedivost</h1>
        </div>
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Upišite LOT broj sa staklenke i vidjet ćete cijeli put meda — od vrcanja i pčelinjaka
              do košnica, tretmana i laboratorijskog nalaza.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (query.trim()) navigate(`/sljedivost/${encodeURIComponent(query.trim())}`)
              }}
              className="flex gap-2"
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                placeholder="KAD-260524-01"
                aria-label="LOT broj"
                className="tabular"
              />
              <Button type="submit">
                <Search />
                Traži
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { batch, harvest, apiary, hives, treatments, labTests, packaging } = data
  const jars = packaging.reduce((sum, p) => sum + p.jarCount, 0)

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center gap-2 print:hidden">
        <Link to="/serije" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Sljedivost</h1>
        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Ispiši lanac"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Printer className="size-5" />
        </button>
      </div>

      <WithdrawalWarning conflicts={data.withdrawalConflicts} />

      <Link
        to={`/serije/${batch.id}`}
        className="block rounded-lg border border-primary/40 bg-primary/5 p-3 hover:border-primary"
      >
        <p className="text-xs text-muted-foreground">LOT</p>
        <p className="tabular text-2xl font-bold tracking-tight">{batch.lotCode}</p>
        <p className="text-sm">
          {batch.honeyType} · {formatNumber(batch.totalKg)} kg
          {batch.moisturePercent !== null && ` · vlaga ${formatNumber(batch.moisturePercent, 1)} %`}
        </p>
      </Link>

      <ChainLink icon={Package} title="Staklenka" empty={packaging.length === 0 ? 'Još nije pakirano' : null}>
        {packaging.map((p) => (
          <Link key={p.id} to={`/pakiranja/${p.id}`} className="block rounded-lg p-1.5 text-sm hover:bg-accent">
            <span className="tabular font-medium">
              {p.jarCount} × {p.jarSizeG} g
            </span>
            <span className="block text-xs text-muted-foreground">
              {formatDate(p.packagedOn)}
              {p.productName ? ` · ${p.productName}` : ''}
              {p.serialFrom ? ` · serijski ${p.serialFrom}${p.serialTo ? `–${p.serialTo}` : ''}` : ''}
              {p.published ? ' · javni QR' : ''}
            </span>
          </Link>
        ))}
        {jars > 0 && (
          <p className="px-1.5 pt-1 text-xs text-muted-foreground">
            Ukupno {jars} {plural(jars, 'staklenka', 'staklenke', 'staklenki')}.
          </p>
        )}
      </ChainLink>

      <ChainLink icon={FlaskConical} title="Laboratorij" empty={labTests.length === 0 ? 'Nema unesenog nalaza' : null}>
        {labTests.map((t) => (
          <Link key={t.id} to={`/nalazi/${t.id}`} className="block rounded-lg p-1.5 text-sm hover:bg-accent">
            <span className="font-medium">{t.laboratory ?? 'Nalaz'}</span>
            <span className="block text-xs text-muted-foreground">
              {formatDate(t.testedOn)}
              {t.reportNumber ? ` · ${t.reportNumber}` : ''} ·{' '}
              <span className={t.verdict === 'fail' ? 'text-critical' : t.verdict === 'pass' ? 'text-ok' : ''}>
                {t.verdict === 'pass'
                  ? 'unutar kriterija'
                  : t.verdict === 'fail'
                    ? 'odstupanje'
                    : 'bez kriterija'}
              </span>
            </span>
          </Link>
        ))}
      </ChainLink>

      <ChainLink icon={Boxes} title="Vrcanje">
        <Link to={`/vrcanja/${harvest.id}`} className="block rounded-lg p-1.5 text-sm hover:bg-accent">
          <span className="font-medium">{formatDate(harvest.harvestedOn)}</span>
          <span className="block text-xs text-muted-foreground">
            paša {harvest.pasture}
            {harvest.hiveRange ? ` · košnice ${harvest.hiveRange}` : ''}
            {harvest.framesCount ? ` · ${harvest.framesCount} okvira` : ''}
          </span>
        </Link>
        {harvest.containers.length > 0 && (
          <p className="px-1.5 text-xs text-muted-foreground">
            Posude: {harvest.containers.map((c) => `${c.name} ${formatNumber(c.amountKg)} kg`).join(', ')}
          </p>
        )}
      </ChainLink>

      <ChainLink icon={Grid2x2} title="Pčelinjak">
        <Link
          to={`/pcelinjaci/${apiary.id}`}
          className="flex min-h-11 items-center rounded-lg p-1.5 text-sm font-medium hover:bg-accent"
        >
          {apiary.name}
        </Link>
      </ChainLink>

      <ChainLink
        icon={Crown}
        title={`Košnice i matice (${hives.length})`}
        empty={hives.length === 0 ? 'Košnice nisu povezane s ovim vrcanjem' : null}
      >
        {/* min-h-11 rather than the compact chip used for read-only hive lists elsewhere: these
            are links, and a 24 px tap target on a phone in the field is a missed tap. */}
        <div className="flex flex-wrap gap-1.5 p-1.5">
          {hives.map((h) => (
            <Link
              key={h.id}
              to={`/kosnice/${h.id}`}
              className="flex min-h-11 flex-col justify-center rounded-lg bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent"
            >
              {h.code}
              {h.queenCode && <span className="font-normal text-muted-foreground">{h.queenCode}</span>}
            </Link>
          ))}
        </div>
      </ChainLink>

      <ChainLink
        icon={Syringe}
        title={`Tretmani prije vrcanja (${treatments.length})`}
        empty={treatments.length === 0 ? 'Nema tretmana u godini prije vrcanja' : null}
      >
        {treatments.map((t) => (
          <Link key={t.id} to={`/tretmani/${t.id}`} className="block rounded-lg p-1.5 text-sm hover:bg-accent">
            <span className="font-medium">{t.productName}</span>
            <span className="block text-xs text-muted-foreground">
              {formatDate(t.startedOn)}
              {t.endedOn ? ` – ${formatDate(t.endedOn)}` : ' – u tijeku'}
              {t.lotNumber ? ` · LOT ${t.lotNumber}` : ''}
              {t.withdrawalUntil ? ` · karenca do ${formatDate(t.withdrawalUntil)}` : ''}
            </span>
          </Link>
        ))}
      </ChainLink>

      {/* §37 lands in Etapa 4. Named rather than hidden so the chain does not silently look
          complete when its last link is still missing. */}
      <ChainLink icon={Package} title="Kupac" empty="Evidencija prodaje dolazi u sljedećoj fazi" />
    </div>
  )
}

function ChainLink({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  empty?: string | null
  children?: React.ReactNode
}) {
  return (
    <div className="relative pl-8">
      {/* The rail that makes it read as one chain rather than six unrelated cards. */}
      <span className="absolute left-3 top-8 h-[calc(100%-1rem)] w-px bg-border" aria-hidden />
      <span className="absolute left-0 top-2 flex size-6 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <Icon className="size-3.5" />
      </span>
      <Card>
        <CardContent className="py-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
          {empty ? <p className="p-1.5 text-sm text-muted-foreground">{empty}</p> : children}
        </CardContent>
      </Card>
    </div>
  )
}
