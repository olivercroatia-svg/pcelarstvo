import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Building2, Check, Landmark, Store, User, Users } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { isValidOib } from '@/lib/oib'
import { cn } from '@/lib/utils'

type EntityType = 'individual' | 'opg' | 'craft' | 'company' | 'other'

const ENTITY_TYPES: { value: EntityType; label: string; hint: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: 'individual', label: 'Fizička osoba', hint: 'Pčelarim za sebe', icon: User },
  { value: 'opg', label: 'OPG', hint: 'Obiteljsko poljoprivredno gospodarstvo', icon: Landmark },
  { value: 'craft', label: 'Obrt', hint: 'Registrirani obrt', icon: Store },
  { value: 'company', label: 'Tvrtka', hint: 'd.o.o., j.d.o.o. i sl.', icon: Building2 },
  { value: 'other', label: 'Druga organizacija', hint: 'Udruga, zadruga, ustanova', icon: Users },
]

const oibField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || isValidOib(v), { message: 'OIB nije ispravan (11 znamenki s kontrolnom znamenkom)' })

const accountSchema = z.object({
  firstName: z.string().trim().min(2, 'Unesite ime'),
  lastName: z.string().trim().min(2, 'Unesite prezime'),
  email: z.email({ message: 'Unesite ispravnu email adresu' }),
  password: z.string().min(8, 'Lozinka mora imati najmanje 8 znakova'),
  phone: z.string().trim().optional(),
  oib: oibField,
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  farmName: z.string().trim().optional(),
  mibpg: z.string().trim().optional(),
  responsiblePerson: z.string().trim().optional(),
})

const beekeepingSchema = z.object({
  eppNumber: z.string().trim().optional(),
  apiaryCount: z.string().trim().optional(),
  colonyCount: z.string().trim().optional(),
  association: z.string().trim().optional(),
  pastureCommissioner: z.string().trim().optional(),
})

type AccountValues = z.infer<typeof accountSchema>
type BeekeepingValues = z.infer<typeof beekeepingSchema>

const blank = (value: string | undefined) => (value && value.length > 0 ? value : undefined)
const numeric = (value: string | undefined) => (value && value.length > 0 ? Number(value) : undefined)

export function RegisterPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [entityType, setEntityType] = useState<EntityType | null>(null)
  const [account, setAccount] = useState<AccountValues | null>(null)

  const { register: registerUser } = useAuth()
  const { showError } = useToast()
  const navigate = useNavigate()

  const isBusiness = entityType !== null && entityType !== 'individual'

  const accountForm = useForm<AccountValues>({ resolver: zodResolver(accountSchema) })
  const beekeepingForm = useForm<BeekeepingValues>({ resolver: zodResolver(beekeepingSchema) })

  async function submitAll(beekeeping: BeekeepingValues) {
    if (!entityType || !account) return
    try {
      await registerUser({
        entityType,
        email: account.email,
        password: account.password,
        firstName: account.firstName,
        lastName: account.lastName,
        phone: blank(account.phone),
        oib: blank(account.oib),
        address: blank(account.address),
        city: blank(account.city),
        postalCode: blank(account.postalCode),
        farmName: blank(account.farmName),
        mibpg: blank(account.mibpg),
        responsiblePerson: blank(account.responsiblePerson),
        eppNumber: blank(beekeeping.eppNumber),
        apiaryCount: numeric(beekeeping.apiaryCount),
        colonyCount: numeric(beekeeping.colonyCount),
        association: blank(beekeeping.association),
        pastureCommissioner: blank(beekeeping.pastureCommissioner),
      })
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        // Field errors from step 2 must send the user back to the step that owns them.
        for (const [key, message] of Object.entries(err.fields)) {
          if (key in accountForm.getValues()) {
            accountForm.setError(key as keyof AccountValues, { message })
            setStep(2)
          }
        }
      }
      showError(err instanceof ApiError ? err.message : 'Registracija nije uspjela')
    }
  }

  return (
    <div className="min-h-dvh bg-honeycomb px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 flex items-center gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              aria-label="Natrag"
              className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <BrandMark className="size-9" />
          )}
          <div>
            <h1 className="text-lg font-bold leading-tight">Registracija</h1>
            <p className="text-xs text-muted-foreground">Korak {step} od 3</p>
          </div>
        </header>

        <div className="mb-6 flex gap-1.5" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3}>
          {[1, 2, 3].map((n) => (
            <div key={n} className={cn('h-1.5 flex-1 rounded-full', n <= step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>

        {/* ── Korak 1: tip subjekta ─────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Ja sam:</p>
            {ENTITY_TYPES.map(({ value, label, hint, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setEntityType(value)
                  setStep(2)
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors',
                  'hover:border-primary hover:bg-accent active:bg-accent/70',
                  entityType === value ? 'border-primary' : 'border-border',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                {entityType === value && <Check className="size-5 text-primary" />}
              </button>
            ))}
          </div>
        )}

        {/* ── Korak 2: osnovni podaci ───────────────────────────────────── */}
        {step === 2 && (
          <form
            noValidate
            onSubmit={accountForm.handleSubmit((values) => {
              setAccount(values)
              setStep(3)
            })}
            className="space-y-4 rounded-2xl border border-border bg-card p-5"
          >
            <Field label="Ime" error={accountForm.formState.errors.firstName?.message}>
              {(p) => <Input {...p} {...accountForm.register('firstName')} autoComplete="given-name" />}
            </Field>
            <Field label="Prezime" error={accountForm.formState.errors.lastName?.message}>
              {(p) => <Input {...p} {...accountForm.register('lastName')} autoComplete="family-name" />}
            </Field>
            <Field label="Email" error={accountForm.formState.errors.email?.message}>
              {(p) => (
                <Input {...p} {...accountForm.register('email')} type="email" inputMode="email" autoComplete="email" />
              )}
            </Field>
            <Field
              label="Lozinka"
              error={accountForm.formState.errors.password?.message}
              hint="Najmanje 8 znakova"
            >
              {(p) => (
                <Input {...p} {...accountForm.register('password')} type="password" autoComplete="new-password" />
              )}
            </Field>

            {isBusiness && (
              <>
                <Field label="Naziv gospodarstva / tvrtke" optional error={accountForm.formState.errors.farmName?.message}>
                  {(p) => <Input {...p} {...accountForm.register('farmName')} placeholder="OPG Matić" />}
                </Field>
                <Field label="MIBPG" optional error={accountForm.formState.errors.mibpg?.message}>
                  {(p) => <Input {...p} {...accountForm.register('mibpg')} inputMode="numeric" />}
                </Field>
                <Field label="Odgovorna osoba" optional error={accountForm.formState.errors.responsiblePerson?.message}>
                  {(p) => <Input {...p} {...accountForm.register('responsiblePerson')} />}
                </Field>
              </>
            )}

            <Field label="OIB" optional error={accountForm.formState.errors.oib?.message}>
              {(p) => <Input {...p} {...accountForm.register('oib')} inputMode="numeric" maxLength={11} />}
            </Field>
            <Field label="Telefon" optional error={accountForm.formState.errors.phone?.message}>
              {(p) => <Input {...p} {...accountForm.register('phone')} type="tel" inputMode="tel" autoComplete="tel" />}
            </Field>
            <Field label="Adresa" optional error={accountForm.formState.errors.address?.message}>
              {(p) => <Input {...p} {...accountForm.register('address')} autoComplete="street-address" />}
            </Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Mjesto" optional error={accountForm.formState.errors.city?.message}>
                {(p) => <Input {...p} {...accountForm.register('city')} autoComplete="address-level2" />}
              </Field>
              <Field label="Poštanski br." optional error={accountForm.formState.errors.postalCode?.message}>
                {(p) => <Input {...p} {...accountForm.register('postalCode')} inputMode="numeric" />}
              </Field>
            </div>

            <Button type="submit" size="lg" className="w-full">
              Nastavi
            </Button>
          </form>
        )}

        {/* ── Korak 3: pčelarski podaci (§5 — sve neobavezno) ───────────── */}
        {step === 3 && (
          <form
            noValidate
            onSubmit={beekeepingForm.handleSubmit(submitAll)}
            className="space-y-4 rounded-2xl border border-border bg-card p-5"
          >
            <p className="text-sm text-muted-foreground">
              Ovo možete popuniti i kasnije — aplikacija će vas podsjetiti što nedostaje.
            </p>

            <Field label="EPP broj">
              {(p) => <Input {...p} {...beekeepingForm.register('eppNumber')} placeholder="03217" />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Broj pčelinjaka">
                {(p) => <Input {...p} {...beekeepingForm.register('apiaryCount')} inputMode="numeric" />}
              </Field>
              <Field label="Broj zajednica">
                {(p) => <Input {...p} {...beekeepingForm.register('colonyCount')} inputMode="numeric" />}
              </Field>
            </div>
            <Field label="Pčelarska udruga">
              {(p) => <Input {...p} {...beekeepingForm.register('association')} />}
            </Field>
            <Field label="Pašni povjerenik">
              {(p) => <Input {...p} {...beekeepingForm.register('pastureCommissioner')} />}
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={beekeepingForm.formState.isSubmitting}
            >
              {beekeepingForm.formState.isSubmitting ? 'Stvaram račun…' : 'Završi registraciju'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Već imate račun?{' '}
          <Link to="/prijava" className="font-medium text-primary underline-offset-4 hover:underline">
            Prijavite se
          </Link>
        </p>
      </div>
    </div>
  )
}
