import { ArrowLeft, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatEur } from '@/lib/format'
import type { Customer } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { CustomerForm } from './Customers'
import { CHANNEL_LABELS } from './Sales'

interface CustomerSale {
  id: string
  soldOn: string
  channel: string
  documentNumber: string | null
  paid: boolean
  total: number
}

/** §38 — one buyer, their details and what they have bought. */
export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<{ customer: Customer; sales: CustomerSale[] }>(
    `/customers/${id}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { customer, sales } = data
  const total = sales.reduce((sum, s) => sum + s.total, 0)

  async function remove() {
    const ok = await confirm({
      title: 'Brisanje kupca',
      description:
        sales.length > 0
          ? `Kupac se uklanja iz adresara. Njegovih ${sales.length} prodaja ostaje evidentirano.`
          : 'Kupac se uklanja iz adresara.',
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/customers/${id}`, { method: 'DELETE' })
      showSuccess('Kupac je uklonjen')
      navigate('/kupci', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/kupci" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{customer.name}</h1>
      </div>

      <CustomerForm initial={customer} onDone={() => reload()} />

      {sales.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prodaje ({sales.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between border-b border-border pb-2 text-sm">
              <span className="text-muted-foreground">Ukupno</span>
              <span className="tabular text-lg font-semibold">{formatEur(total)}</span>
            </div>
            {sales.map((s) => (
              <Link
                key={s.id}
                to={`/prodaja/${s.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-1 hover:bg-accent"
              >
                <span className="min-w-0 text-sm">
                  {formatDate(s.soldOn)}
                  <span className="block text-xs text-muted-foreground">
                    {CHANNEL_LABELS[s.channel] ?? s.channel}
                    {s.paid ? '' : ' · nije naplaćeno'}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm font-medium">{formatEur(s.total)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Button variant="outline" className="w-full text-destructive" onClick={remove}>
        <Trash2 />
        Ukloni kupca
      </Button>
    </div>
  )
}
