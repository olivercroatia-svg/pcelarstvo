import { ArrowLeft, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatEur } from '@/lib/format'
import { CUSTOMER_KIND_LABELS } from '@/lib/labels'
import type { Customer, CustomerKind } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/** §38 — the address book. Business buyers carry an OIB, which is why this is owner-only (§56). */
export function CustomersPage() {
  const [adding, setAdding] = useState(false)
  const { data, error, loading, reload } = useResource<{ customers: Customer[] }>('/customers')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const customers = data?.customers ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Kupci</h1>
      </div>

      {adding ? (
        <CustomerForm
          onDone={async () => {
            setAdding(false)
            await reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Novi kupac
        </Button>
      )}

      {customers.length === 0 && !adding ? (
        <EmptyState
          icon={Users}
          title="Adresar je prazan"
          description="Kupci nisu obavezni — prodaja na sajmu ide i bez njih. Trgovinama i restoranima trebaju podaci za račun."
        />
      ) : (
        <div className="space-y-3">
          {customers.map((c) => (
            <Link key={c.id} to={`/kupci/${c.id}`} className="block">
              <Card className="transition-colors hover:border-primary">
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {CUSTOMER_KIND_LABELS[c.kind]}
                        {c.city ? ` · ${c.city}` : ''}
                      </p>
                    </div>
                    {(c.salesCount ?? 0) > 0 && (
                      <div className="shrink-0 text-right">
                        <p className="tabular font-semibold">{formatEur(c.totalSpent)}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.lastSaleOn ? formatDate(c.lastSaleOn) : ''}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function CustomerForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: Customer
  onDone: (customer: Customer) => void | Promise<void>
  onCancel?: () => void
}) {
  const { showSuccess, showError } = useToast()
  const [kind, setKind] = useState<CustomerKind>(initial?.kind ?? 'person')
  const [name, setName] = useState(initial?.name ?? '')
  const [oib, setOib] = useState(initial?.oib ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '')
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // §38 lists naziv, OIB, adresa, kontakt, email only for business buyers. A private buyer at a
  // market stall gets the short form, which is the difference between a record and no record.
  const isBusiness = kind !== 'person'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (name.trim().length < 2) return setFieldErrors({ name: 'Unesite naziv kupca' })

    setSaving(true)
    try {
      const body = {
        kind,
        name: name.trim(),
        oib: oib.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        postalCode: postalCode.trim() || null,
        contactPerson: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      }
      const result = initial
        ? await api<{ customer: Customer }>(`/customers/${initial.id}`, { method: 'PATCH', body })
        : await api<{ customer: Customer }>('/customers', { method: 'POST', body })
      showSuccess(initial ? 'Podaci su spremljeni' : 'Kupac je dodan')
      await onDone(result.customer)
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
        <CardTitle className="text-base">{initial ? 'Podaci kupca' : 'Novi kupac'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label="Vrsta">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as CustomerKind)}>
                {Object.entries(CUSTOMER_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={isBusiness ? 'Naziv' : 'Ime i prezime'} error={fieldErrors.name}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>

          {isBusiness && (
            <>
              <Field label="OIB" optional error={fieldErrors.oib} hint="11 znamenki">
                {(p) => (
                  <Input {...p} inputMode="numeric" maxLength={11} value={oib} onChange={(e) => setOib(e.target.value)} />
                )}
              </Field>
              <Field label="Kontakt osoba" optional>
                {(p) => <Input {...p} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />}
              </Field>
            </>
          )}

          <Field label="Adresa" optional>
            {(p) => <Input {...p} value={address} onChange={(e) => setAddress(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Poštanski broj" optional>
              {(p) => <Input {...p} inputMode="numeric" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />}
            </Field>
            <div className="col-span-2">
              <Field label="Mjesto" optional>
                {(p) => <Input {...p} value={city} onChange={(e) => setCity(e.target.value)} />}
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefon" optional>
              {(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            <Field label="Email" optional error={fieldErrors.email}>
              {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Spremam…' : 'Spremi'}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                Odustani
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
