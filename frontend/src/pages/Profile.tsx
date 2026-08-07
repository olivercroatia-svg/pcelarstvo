import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { useAuth, type CurrentUser } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { isValidOib } from '@/lib/oib'

const schema = z.object({
  firstName: z.string().trim().min(2, 'Unesite ime'),
  lastName: z.string().trim().min(2, 'Unesite prezime'),
  phone: z.string().trim().optional(),
  farmName: z.string().trim().optional(),
  oib: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidOib(v), { message: 'OIB nije ispravan' }),
  mibpg: z.string().trim().optional(),
  responsiblePerson: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  eppNumber: z.string().trim().optional(),
  apiaryCount: z.string().trim().optional(),
  colonyCount: z.string().trim().optional(),
  association: z.string().trim().optional(),
  pastureCommissioner: z.string().trim().optional(),
})

type FormValues = z.infer<typeof schema>

// Empty string means "clear this field", so it maps to null rather than being dropped.
const text = (v: string | undefined) => (v && v.length > 0 ? v : null)
const num = (v: string | undefined) => (v && v.length > 0 ? Number(v) : null)
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))

export function ProfilePage() {
  const { current, refresh, isOwner } = useAuth()
  const { showSuccess, showError } = useToast()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      firstName: str(current?.user.firstName),
      lastName: str(current?.user.lastName),
      phone: str(current?.user.phone),
      farmName: str(current?.farm?.name),
      oib: str(current?.farm?.oib),
      mibpg: str(current?.farm?.mibpg),
      responsiblePerson: str(current?.farm?.responsiblePerson),
      address: str(current?.farm?.address),
      city: str(current?.farm?.city),
      postalCode: str(current?.farm?.postalCode),
      eppNumber: str(current?.farm?.eppNumber),
      apiaryCount: str(current?.farm?.apiaryCount),
      colonyCount: str(current?.farm?.colonyCount),
      association: str(current?.farm?.association),
      pastureCommissioner: str(current?.farm?.pastureCommissioner),
    },
  })

  if (!current) return null
  const isBusiness = current.farm?.entityType !== 'individual'

  const onSubmit = handleSubmit(async (values) => {
    try {
      await api<CurrentUser>('/me', {
        method: 'PATCH',
        body: {
          firstName: values.firstName,
          lastName: values.lastName,
          phone: text(values.phone),
          ...(isOwner && {
            farmName: text(values.farmName),
            oib: text(values.oib),
            mibpg: text(values.mibpg),
            responsiblePerson: text(values.responsiblePerson),
            address: text(values.address),
            city: text(values.city),
            postalCode: text(values.postalCode),
            eppNumber: text(values.eppNumber),
            apiaryCount: num(values.apiaryCount),
            colonyCount: num(values.colonyCount),
            association: text(values.association),
            pastureCommissioner: text(values.pastureCommissioner),
          }),
        },
      })
      await refresh()
      showSuccess('Podaci su spremljeni')
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [key, message] of Object.entries(err.fields)) {
          setError(key as keyof FormValues, { message })
        }
      }
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Profil i gospodarstvo</h1>

      <Card>
        <CardHeader>
          <CardTitle>Osobni podaci</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Ime" error={errors.firstName?.message}>
            {(p) => <Input {...p} {...register('firstName')} autoComplete="given-name" />}
          </Field>
          <Field label="Prezime" error={errors.lastName?.message}>
            {(p) => <Input {...p} {...register('lastName')} autoComplete="family-name" />}
          </Field>
          <Field label="Telefon" optional error={errors.phone?.message}>
            {(p) => <Input {...p} {...register('phone')} type="tel" inputMode="tel" />}
          </Field>
          <Field label="Email">
            {(p) => <Input {...p} value={current.user.email} readOnly disabled />}
          </Field>
        </CardContent>
      </Card>

      {isOwner ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Gospodarstvo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isBusiness && (
                <>
                  <Field label="Naziv" optional error={errors.farmName?.message}>
                    {(p) => <Input {...p} {...register('farmName')} />}
                  </Field>
                  <Field label="MIBPG" optional error={errors.mibpg?.message}>
                    {(p) => <Input {...p} {...register('mibpg')} inputMode="numeric" />}
                  </Field>
                  <Field label="Odgovorna osoba" optional error={errors.responsiblePerson?.message}>
                    {(p) => <Input {...p} {...register('responsiblePerson')} />}
                  </Field>
                </>
              )}
              <Field label="OIB" optional error={errors.oib?.message}>
                {(p) => <Input {...p} {...register('oib')} inputMode="numeric" maxLength={11} />}
              </Field>
              <Field label="Adresa" optional error={errors.address?.message}>
                {(p) => <Input {...p} {...register('address')} />}
              </Field>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <Field label="Mjesto" optional error={errors.city?.message}>
                  {(p) => <Input {...p} {...register('city')} />}
                </Field>
                <Field label="Poštanski br." optional error={errors.postalCode?.message}>
                  {(p) => <Input {...p} {...register('postalCode')} inputMode="numeric" />}
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pčelarski podaci</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="EPP broj" optional error={errors.eppNumber?.message}>
                {(p) => <Input {...p} {...register('eppNumber')} />}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Broj pčelinjaka" optional error={errors.apiaryCount?.message}>
                  {(p) => <Input {...p} {...register('apiaryCount')} inputMode="numeric" />}
                </Field>
                <Field label="Broj zajednica" optional error={errors.colonyCount?.message}>
                  {(p) => <Input {...p} {...register('colonyCount')} inputMode="numeric" />}
                </Field>
              </div>
              <Field label="Pčelarska udruga" optional error={errors.association?.message}>
                {(p) => <Input {...p} {...register('association')} />}
              </Field>
              <Field label="Pašni povjerenik" optional error={errors.pastureCommissioner?.message}>
                {(p) => <Input {...p} {...register('pastureCommissioner')} />}
              </Field>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">
            Podatke gospodarstva može mijenjati samo vlasnik.
          </CardContent>
        </Card>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? 'Spremam…' : 'Spremi promjene'}
      </Button>
    </form>
  )
}
