import { zodResolver } from '@hookform/resolvers/zod'
import { Download, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

/**
 * §56 — the two rights the beekeeper can exercise without asking anyone: take everything, and go.
 *
 * They share a screen deliberately. Deleting is irreversible and takes the statutory register with
 * it, so the only honest place for the download button is directly above the delete button, where
 * it is impossible to reach the second without having seen the first.
 */

const ERASE_WORD = 'OBRIŠI'

const eraseSchema = z.object({
  password: z.string().min(1, 'Unesite lozinku'),
  confirm: z.string().refine((v) => v.trim().toUpperCase() === ERASE_WORD, {
    message: `Upišite ${ERASE_WORD}`,
  }),
})

type EraseValues = z.infer<typeof eraseSchema>

export function MyDataPage() {
  const { current, isOwner } = useAuth()
  const { showError, showSuccess } = useToast()
  const [downloading, setDownloading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EraseValues>({ resolver: zodResolver(eraseSchema) })

  async function download() {
    setDownloading(true)
    try {
      // Not routed through lib/api: that helper parses JSON into an object, and the point here is
      // the file itself — the beekeeper keeps it, opens it, hands it to whoever asks.
      const response = await fetch(`${import.meta.env.BASE_URL}api/me/export`, {
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error((payload?.error as string | undefined) ?? 'Preuzimanje nije uspjelo')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `moj-pcelinjak-podaci-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      showSuccess('Datoteka s vašim podacima je preuzeta')
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Preuzimanje nije uspjelo')
    } finally {
      setDownloading(false)
    }
  }

  const erase = handleSubmit(async (values) => {
    try {
      await api<{ ok: boolean }>('/me', {
        method: 'DELETE',
        body: { password: values.password, confirm: values.confirm.trim().toUpperCase() },
      })

      // Queued offline entries belong to an account that no longer exists; left behind they would
      // retry forever against a farm the server has closed.
      await db.outbox.clear().catch(() => undefined)

      // A full reload rather than a client-side navigation: the session cookie is gone and every
      // provider in the tree still holds state for a user who does not. Reloading is the one way
      // to be certain none of it survives.
      window.location.href = import.meta.env.BASE_URL
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('password', { message: 'Lozinka nije ispravna' })
        return
      }
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  })

  if (!current) return null

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Moji podaci</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preuzimanje i brisanje vaših podataka. Što aplikacija čuva i kome to odlazi piše na{' '}
          <Link to="/privatnost" className="text-primary underline-offset-4 hover:underline">
            stranici o privatnosti
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preuzimanje podataka</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isOwner
              ? 'Jedna JSON datoteka sa svim zapisima gospodarstva — pčelinjaci, košnice, pregledi, tretmani, vrcanja, serije, prodaje i troškovi. Otvara se u svakom uređivaču teksta i može se učitati u drugi program.'
              : 'Jedna JSON datoteka s vašim korisničkim podacima i zapisima koje ste sami unijeli. Evidencija gospodarstva pripada vlasniku i nije dio izvoza.'}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Fotografije i skenirani dokumenti nisu u datoteci — u zapisima su njihovi nazivi, a same
            datoteke preuzmite iz aplikacije dok račun još postoji.
          </p>
          <Button type="button" size="lg" className="w-full" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            {downloading ? 'Pripremam…' : 'Preuzmi moje podatke'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Brisanje računa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Brisanje je trajno i ne može se poništiti.
            {isOwner
              ? ' Uz račun se zatvara i gospodarstvo: evidencije, dokumenti i fotografije prestaju biti dostupni, a svi članovi gube pristup.'
              : ' Vaš pristup gospodarstvu prestaje, a zapisi koje ste unijeli ostaju u evidenciji gospodarstva bez vašeg imena.'}
          </p>
          <p className="flex gap-2 rounded-lg bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              Evidenciju o primjeni veterinarsko-medicinskih proizvoda i druge propisane zapise
              dužni ste čuvati i nakon prestanka korištenja aplikacije. Preuzmite podatke prije
              brisanja — to je jedini primjerak koji ćete dobiti.
            </span>
          </p>

          {!confirming ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              Želim obrisati račun
            </Button>
          ) : (
            <form onSubmit={erase} noValidate className="space-y-4">
              <Field label="Vaša lozinka" error={errors.password?.message}>
                {(p) => (
                  <Input {...p} {...register('password')} type="password" autoComplete="current-password" />
                )}
              </Field>
              <Field label={`Za potvrdu upišite ${ERASE_WORD}`} error={errors.confirm?.message}>
                {(p) => <Input {...p} {...register('confirm')} autoCapitalize="characters" autoComplete="off" />}
              </Field>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setConfirming(false)}
                  disabled={isSubmitting}
                >
                  Odustani
                </Button>
                <Button type="submit" variant="destructive" className="flex-1" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                  {isSubmitting ? 'Brišem…' : 'Obriši trajno'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
