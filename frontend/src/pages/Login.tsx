import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { ApiError } from '@/lib/api'

const schema = z.object({
  email: z.email({ message: 'Unesite ispravnu email adresu' }),
  password: z.string().min(1, 'Unesite lozinku'),
})

type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const { login } = useAuth()
  const { showError } = useToast()
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password)
      navigate('/', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Prijava nije uspjela')
    }
  })

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-honeycomb px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto size-14" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Moj Pčelinjak</h1>
          <p className="mt-1 text-sm text-muted-foreground">Digitalni dnevnik hrvatskog pčelara</p>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <Field label="Email" error={errors.email?.message}>
            {(props) => (
              <Input
                {...props}
                {...register('email')}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="ivan@primjer.hr"
              />
            )}
          </Field>

          <Field label="Lozinka" error={errors.password?.message}>
            {(props) => (
              <Input {...props} {...register('password')} type="password" autoComplete="current-password" />
            )}
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Prijava…' : 'Prijavi se'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Nemate račun?{' '}
          <Link to="/registracija" className="font-medium text-primary underline-offset-4 hover:underline">
            Registrirajte se
          </Link>
        </p>
      </div>
    </div>
  )
}
