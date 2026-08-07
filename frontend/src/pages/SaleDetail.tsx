import { ArrowLeft, GitBranch, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatEur, formatNumber } from '@/lib/format'
import type { Sale, SaleItem } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { CHANNEL_LABELS, PAYMENT_LABELS } from './Sales'

/** §37 — one sale. Lines are not editable; see the note at the top of routes/sales.ts. */
export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<{ sale: Sale; items: SaleItem[] }>(`/sales/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { sale, items } = data

  async function togglePaid() {
    try {
      await api(`/sales/${id}`, { method: 'PATCH', body: { paid: !sale.paid } })
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  async function remove() {
    const returned = items
      .filter((i) => i.kind !== 'other')
      .map((i) => `${formatNumber(i.quantity)} ${i.unit} — ${i.description}`)
    const ok = await confirm({
      title: 'Brisanje prodaje',
      description:
        returned.length > 0
          ? `Zaliha se vraća na skladište: ${returned.join(', ')}.`
          : 'Prodaja se briše. Skladište se ne mijenja jer nijedna stavka nije bila s njega.',
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/sales/${id}`, { method: 'DELETE' })
      showSuccess('Prodaja je obrisana, zaliha je vraćena')
      navigate('/prodaja', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/prodaja" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="tabular min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{formatEur(sale.total)}</h1>
      </div>

      <Card>
        <CardContent className="py-3">
          <dl className="space-y-1.5 text-sm">
            <Row
              label="Kupac"
              value={
                sale.customerId ? (
                  <Link to={`/kupci/${sale.customerId}`} className="font-medium text-primary hover:underline">
                    {sale.customerName}
                  </Link>
                ) : (
                  'Bez kupca'
                )
              }
            />
            <Row label="Datum" value={formatDate(sale.soldOn)} />
            <Row label="Kanal" value={CHANNEL_LABELS[sale.channel]} />
            <Row label="Plaćanje" value={PAYMENT_LABELS[sale.payment]} />
            {sale.documentNumber && <Row label="Broj računa" value={sale.documentNumber} />}
            {sale.honeyKg > 0 && <Row label="Meda" value={`${formatNumber(sale.honeyKg, 3)} kg`} />}
            {sale.notes && <Row label="Napomena" value={sale.notes} />}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stavke</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium">{item.description}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {formatNumber(item.quantity)} {item.unit} × {formatEur(item.unitPrice)}
                  {item.honeyKg > 0 ? ` · ${formatNumber(item.honeyKg, 3)} kg` : ''}
                </p>
                {item.lotCode && (
                  <Link
                    to={`/sljedivost/${item.lotCode}`}
                    className="tabular mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <GitBranch className="size-3" />
                    {item.lotCode}
                  </Link>
                )}
              </div>
              <span className="tabular shrink-0 font-semibold">{formatEur(item.lineTotal)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={togglePaid}>
        {sale.paid ? 'Označi kao nenaplaćeno' : 'Označi kao naplaćeno'}
      </Button>

      <Button variant="outline" className="w-full text-destructive" onClick={remove}>
        <Trash2 />
        Obriši prodaju
      </Button>

      <p className="text-xs text-muted-foreground">
        Stavke se ne mijenjaju naknadno. Ispravak se radi brisanjem prodaje — zaliha se vrati — i
        ponovnim unosom.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  )
}
