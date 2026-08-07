import {
  ArrowRight,
  BellRing,
  ClipboardCheck,
  CloudOff,
  Euro,
  Mic,
  QrCode,
  ShieldCheck,
  Syringe,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { buttonVariants } from '@/components/ui/button'
import { Disclaimer } from '@/components/ui/disclaimer'
import { cn } from '@/lib/utils'

/**
 * §65 + §66 — the public face of the application, and the only screen written for someone who is
 * not yet a user.
 *
 * Two constraints shape it. It is read on a phone, usually the same phone that will later record
 * an inspection, so it is drawn at 390 px like everything else. And it is the one page that must
 * not promise more than the application does: a beekeeper who signs up expecting automatic disease
 * diagnosis (§44 forbids it) or legal advice (§55) has been mis-sold, and finds out at the worst
 * possible moment. Every claim below maps to a screen that exists.
 *
 * Lazy-loaded from App.tsx for the same reason as the public jar page: a beekeeper opening the
 * installed PWA to record a visit should not download the marketing copy to get there.
 */

interface Feature {
  icon: LucideIcon
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    icon: ClipboardCheck,
    title: 'Pregled košnice u pola minute',
    body: 'Snaga, leglo, matica, rojenje — velike tipke, jednom rukom, u rukavicama. Datum, vrijeme i košnica popune se sami.',
  },
  {
    icon: BellRing,
    title: 'Rokovi koji vas sami nađu',
    body: 'Zakonske obveze vode se kao popis rokova, a podsjetnik stiže 60, 30, 14, 7 i 3 dana ranije. Ne morate ih pamtiti.',
  },
  {
    icon: Syringe,
    title: 'Evidencija VMP-a i karenca',
    body: 'Tretman, LOT lijeka i karenca na jednom mjestu — s upozorenjem kad bi vrcanje palo unutar karencije.',
  },
  {
    icon: QrCode,
    title: 'Sljedivost do košnice',
    body: 'Svaka staklenka nosi LOT koji vodi natrag do pakiranja, laboratorijskog nalaza, vrcanja i konkretnih košnica.',
  },
  {
    icon: ShieldCheck,
    title: 'Inspekcijski mod',
    body: 'Jedan ekran koji se pokaže inspektoru: evidencije, dokumenti, tretmani. Bez cijena, bez kupaca, bez zarade.',
  },
  {
    icon: Euro,
    title: 'Ekonomika po pčelinjaku',
    body: 'Koliko vas stvarno košta kilogram meda i koji pčelinjak nosi sezonu. Financije vidi samo vlasnik.',
  },
]

/** §67 — the chain the whole production module exists to keep intact. */
const CHAIN = ['Košnica', 'Vrcanje', 'LOT', 'Nalaz', 'Staklenka', 'Kupac']

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2">
          <BrandMark className="size-8" />
          <span className="font-bold tracking-tight">Moj Pčelinjak</span>
        </span>
        <Link
          to="/prijava"
          className="rounded-lg px-3 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Prijava
        </Link>
      </header>

      {/* ─────────────────────────────────────────────── §65 hero */}
      <section className="bg-honeycomb px-5 pb-12 pt-8">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Za hrvatske pčelare
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Od košnice do staklenke, sve zapisano na jednom mjestu.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Moj Pčelinjak vodi evidenciju pregleda, tretmana i vrcanja, prati zakonske rokove i
            izvodi deklaraciju s LOT-om — s mobitela, i kad nema signala.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link to="/registracija" className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}>
              Otvorite račun
              <ArrowRight />
            </Link>
            <Link
              to="/prijava"
              className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'w-full sm:w-auto')}
            >
              Već imam račun
            </Link>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Radi u pregledniku i instalira se na početni zaslon. Bez instalacije iz trgovine.
          </p>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── §66 the message */}
      <section className="border-y border-border bg-card px-5 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight">Bilježnica u kutiji ne prolazi na inspekciji</h2>
          <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li className="border-l-2 border-primary/40 pl-3">
              Rok za prijavu prošao je prije dva tjedna, a nitko vas nije podsjetio.
            </li>
            <li className="border-l-2 border-primary/40 pl-3">
              Inspektor traži evidenciju o primjeni lijekova za protekle tri godine, a ona je u tri
              bilježnice i jednoj kutiji od cipela.
            </li>
            <li className="border-l-2 border-primary/40 pl-3">
              Kupac drži staklenku u ruci i pita iz koje je paše — a odgovor znate samo približno.
            </li>
          </ul>
          <p className="mt-6 text-base leading-relaxed">
            Aplikacija ne pčelari umjesto vas. Preuzima papirologiju oko pčelarenja, da vrijeme koje
            danas ide na traženje podataka ostane pčelama.
          </p>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── what it does */}
      <section className="px-5 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight">Što aplikacija radi</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border bg-card p-4">
                <Icon className="size-5 text-primary" aria-hidden />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── §3 offline */}
      <section className="border-y border-border bg-secondary px-5 py-10">
        <div className="mx-auto flex max-w-2xl gap-4">
          <CloudOff className="mt-1 size-6 shrink-0 text-secondary-foreground" aria-hidden />
          <div>
            <h2 className="text-xl font-bold tracking-tight text-secondary-foreground">
              Radi i bez signala
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary-foreground/80">
              Pčelinjaci rijetko imaju pune četiri crtice. Novi unos sprema se na uređaj i pošalje
              se sam čim se veza vrati — bez dupliranja i bez izgubljenog pregleda.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── §67 the chain */}
      <section className="px-5 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight">Jedan lanac, od košnice do kupca</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Podatak se upisuje jednom i putuje dalje sam. Kad kupac skenira kod sa staklenke,
            vidi vrstu meda, godinu i pčelara — a nikad vašu lokaciju ni OIB.
          </p>
          <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2">
            {CHAIN.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium">
                  {step}
                </span>
                {i < CHAIN.length - 1 && (
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── §13 + §45, honestly */}
      <section className="border-t border-border px-5 py-12">
        <div className="mx-auto max-w-2xl">
          <Mic className="size-5 text-primary" aria-hidden />
          <h2 className="mt-3 text-2xl font-bold tracking-tight">Glasovni unos i asistent</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Neobavezno, i uključuje se posebno. Pregled možete izdiktirati umjesto tipkati,
            kutiju lijeka fotografirati umjesto prepisivati, a vlastite podatke pitati običnom
            rečenicom. Prije spremanja uvijek vidite što je aplikacija razumjela i potvrđujete vi.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Ono što ne radi: ne postavlja dijagnozu bolesti i ne zamjenjuje veterinara ni
            laboratorijski nalaz.
          </p>
        </div>
      </section>

      {/* ─────────────────────────────────────────────── closing */}
      <section className="bg-honeycomb px-5 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight">Počnite od jedne košnice</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Otvaranje računa traje minutu. Pčelinjak, košnice i evidencije dodajete kad stignete.
          </p>
          <Link
            to="/registracija"
            className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full sm:w-auto')}
          >
            Otvorite račun
            <ArrowRight />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8">
        <div className="mx-auto max-w-2xl space-y-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2 font-semibold">
              <BrandMark className="size-5" />
              Moj Pčelinjak
            </span>
            <Link to="/prijava" className="text-muted-foreground underline-offset-4 hover:underline">
              Prijava
            </Link>
            <Link to="/registracija" className="text-muted-foreground underline-offset-4 hover:underline">
              Registracija
            </Link>
            <Link to="/privatnost" className="text-muted-foreground underline-offset-4 hover:underline">
              Privatnost i osobni podaci
            </Link>
          </div>

          <Disclaimer />
        </div>
      </footer>
    </div>
  )
}
