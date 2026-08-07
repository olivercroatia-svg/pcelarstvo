import { ArrowLeft, Paperclip, Plus, Receipt, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AiScan, Unreadable } from '@/components/AiScan'
import type { ReceiptDraft } from '@/lib/ai'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatEur, todayIso } from '@/lib/format'
import type { Apiary, Expense, ExpenseCategory } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

interface Response {
  expenses: Expense[]
  breakdown: { category: string; label: string; total: number; entries: number }[]
  total: number
  categories: { value: ExpenseCategory; label: string }[]
}

interface DocumentOption {
  id: string
  title: string
}

/**
 * §39 troškovi and §51 the receipt archive.
 *
 * The receipt is attached by picking a document that is already in the §22 archive rather than by
 * uploading here. One upload path, one place a scanned piece of paper lives — and the receipt then
 * shows up in Dokumenti and in Inspekcija mod like everything else.
 */
export function ExpensesPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [category, setCategory] = useState<ExpenseCategory | ''>('')
  const [adding, setAdding] = useState(false)
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()

  const query = `?year=${year}${category ? `&category=${category}` : ''}`
  const { data, error, loading, reload } = useResource<Response>(`/expenses${query}`)
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const { data: documentData } = useResource<{ documents: DocumentOption[] }>('/documents')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const expenses = data?.expenses ?? []
  const breakdown = data?.breakdown ?? []
  const categories = data?.categories ?? []
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)

  async function remove(expense: Expense) {
    const ok = await confirm({
      title: 'Brisanje troška',
      description: `${expense.categoryLabel} · ${formatEur(expense.amount)}`,
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/expenses/${expense.id}`, { method: 'DELETE' })
      showSuccess('Trošak je obrisan')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Troškovi</h1>
      </div>

      {adding ? (
        <ExpenseForm
          categories={categories}
          apiaries={apiaryData?.apiaries ?? []}
          documents={documentData?.documents ?? []}
          onDone={async () => {
            setAdding(false)
            await reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Novi trošak
        </Button>
      )}

      <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Godina">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}.
          </option>
        ))}
      </Select>

      {breakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Ukupno {year}. · <span className="tabular">{formatEur(data?.total)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <FilterChip active={category === ''} onClick={() => setCategory('')}>
                Sve
              </FilterChip>
              {breakdown.map((b) => (
                <FilterChip
                  key={b.category}
                  active={category === b.category}
                  onClick={() => setCategory(category === b.category ? '' : (b.category as ExpenseCategory))}
                >
                  {b.label} · {formatEur(b.total, 0)}
                </FilterChip>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nema evidentiranih troškova"
          description="Troškovi po pčelinjaku daju €/kg u ekonomici i podlogu za dokumentaciju potpora."
        />
      ) : (
        <div className="space-y-3">
          {expenses.map((e) => (
            <Card key={e.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.description ?? e.categoryLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(e.spentOn)} · {e.categoryLabel}
                      {e.supplier ? ` · ${e.supplier}` : ''}
                      {e.apiaryName ? ` · ${e.apiaryName}` : ''}
                    </p>
                    {e.documentId && (
                      <Link
                        to="/dokumenti"
                        className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Paperclip className="size-3" />
                        {e.documentTitle ?? 'Račun'}
                      </Link>
                    )}
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <div className="text-right">
                      <p className="tabular font-semibold">{formatEur(e.amount)}</p>
                      {e.vatAmount !== null && (
                        <p className="tabular text-xs text-muted-foreground">PDV {formatEur(e.vatAmount)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(e)}
                      aria-label={`Obriši trošak ${e.description ?? e.categoryLabel}`}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-full border px-3 text-xs font-medium',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

function ExpenseForm({
  categories,
  apiaries,
  documents,
  onDone,
  onCancel,
}: {
  categories: { value: ExpenseCategory; label: string }[]
  apiaries: Apiary[]
  documents: DocumentOption[]
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  const { showSuccess, showError } = useToast()
  const [spentOn, setSpentOn] = useState(todayIso())
  const [category, setCategory] = useState<ExpenseCategory>('equipment')
  const [supplier, setSupplier] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [apiaryId, setApiaryId] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [unreadable, setUnreadable] = useState<string[]>([])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (!amount || Number(amount) <= 0) return setFieldErrors({ amount: 'Unesite iznos' })

    setSaving(true)
    try {
      await api('/expenses', {
        method: 'POST',
        body: {
          spentOn,
          category,
          supplier: supplier.trim() || null,
          description: description.trim() || null,
          amount: Number(amount),
          vatAmount: vatAmount === '' ? null : Number(vatAmount),
          apiaryId: apiaryId || null,
          documentId: documentId || null,
        },
      })
      showSuccess('Trošak je evidentiran')
      await onDone()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Novi trošak</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          {/* §39 — "fotografiranje računa". Owner-only end to end: the route itself is behind
              requireOwner, so a worker never sees a supplier or an amount even in a draft. */}
          <AiScan<ReceiptDraft>
            endpoint="/ai/read/receipt"
            label="Fotografiraj račun"
            hint="Slikajte račun — datum, dobavljač i iznos se popune, a vi ih provjerite."
            onDraft={(d) => {
              if (d.spentOn) setSpentOn(d.spentOn)
              if (d.supplier) setSupplier(d.supplier)
              if (d.description) setDescription(d.description)
              // Comma, not dot: the input is text and the rest of this form is Croatian.
              if (d.amount !== null) setAmount(String(d.amount).replace('.', ','))
              if (d.vatAmount !== null) setVatAmount(String(d.vatAmount).replace('.', ','))
              if (d.category) setCategory(d.category as ExpenseCategory)
              setUnreadable(d.unreadable)
            }}
          >
            <Unreadable fields={unreadable} />
          </AiScan>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum">
              {(p) => <Input {...p} type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />}
            </Field>
            <Field label="Kategorija">
              {(p) => (
                <Select {...p} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Iznos (€)" error={fieldErrors.amount}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field label="Od toga PDV" optional>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={vatAmount}
                  onChange={(e) => setVatAmount(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Opis" optional>
            {(p) => (
              <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Šećer 500 kg" />
            )}
          </Field>
          <Field label="Dobavljač" optional>
            {(p) => <Input {...p} value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
          </Field>

          {apiaries.length > 0 && (
            <Field
              label="Pčelinjak"
              optional
              hint="Trošak vezan uz jedan pčelinjak ulazi u njegovu ekonomiku; bez odabira ide u zajedničke troškove"
            >
              {(p) => (
                <Select {...p} value={apiaryId} onChange={(e) => setApiaryId(e.target.value)}>
                  <option value="">Zajednički trošak</option>
                  {apiaries.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {documents.length > 0 && (
            <Field label="Račun iz arhive" optional hint="Prvo učitajte račun u Dokumente, pa ga ovdje povežite">
              {(p) => (
                <Select {...p} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
                  <option value="">Bez priloženog računa</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Spremam…' : 'Spremi trošak'}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Odustani
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
