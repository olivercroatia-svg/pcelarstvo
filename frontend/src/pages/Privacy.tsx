import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'

/**
 * §56 — what the application holds, where it goes, and how to get it back or get rid of it.
 *
 * Written from the schema rather than from a template. Every sentence below names something that
 * actually exists: the three outbound services are the three the backend really calls, the list of
 * stored data is the list of tables, and the two rights at the bottom are the two endpoints on
 * /api/me. A privacy notice that describes a generic web app is worse than none, because it is
 * confidently wrong about the one thing a reader came to check.
 *
 * Public and unauthenticated on purpose: someone deciding whether to open an account has to be
 * able to read it first (čl. 13).
 */

/**
 * The controller. Deliberately blank rather than filled with a plausible placeholder: an
 * unattributed privacy notice is a legal defect, and the banner below makes it impossible to put
 * this page in front of a user without noticing.
 */
const OPERATOR = {
  name: '',
  address: '',
  email: '',
}

/** Bump when the text below changes — a notice without a date cannot be shown to have been given. */
const LAST_UPDATED = '7. kolovoza 2026.'

const operatorMissing = !OPERATOR.name || !OPERATOR.address || !OPERATOR.email

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Link
          to="/"
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <BrandMark className="size-6" />
        <span className="font-semibold tracking-tight">Moj Pčelinjak</span>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-5 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Privatnost i osobni podaci</h1>
          <p className="mt-1 text-xs text-muted-foreground">Zadnja izmjena: {LAST_UPDATED}</p>
        </div>

        {operatorMissing && (
          <p className="flex gap-2 rounded-lg border border-caution/50 bg-caution/10 p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
            <span>
              Podaci o voditelju obrade još nisu upisani. Prije javne objave popunite ih u
              <code className="mx-1 rounded bg-muted px-1">src/pages/Privacy.tsx</code>
              i dajte tekst na pravnu provjeru.
            </span>
          </p>
        )}

        <Section title="Tko obrađuje podatke">
          <p>
            Voditelj obrade je {OPERATOR.name || '[naziv voditelja obrade]'},{' '}
            {OPERATOR.address || '[adresa]'}. Za sva pitanja o osobnim podacima pišite na{' '}
            {OPERATOR.email || '[email adresa]'}.
          </p>
        </Section>

        <Section title="Koje podatke aplikacija čuva">
          <p>
            <strong className="text-foreground">Račun:</strong> ime i prezime, email adresa,
            neobavezno telefon. Uz svaku prijavu bilježi se vrijeme, IP adresa i vrsta preglednika —
            to je zapis koji omogućuje odjavu sa svih uređaja i uočavanje tuđe prijave.
          </p>
          <p>
            <strong className="text-foreground">Gospodarstvo:</strong> naziv, OIB, MIBPG, adresa,
            broj iz Evidencije pčelara i pčelinjaka, udruga i pašni povjerenik.
          </p>
          <p>
            <strong className="text-foreground">Pčelarska evidencija:</strong> pčelinjaci s GPS
            koordinatama, košnice, zajednice i matice, pregledi, zdravstveni događaji, mjerenja
            varooze, primjena veterinarsko-medicinskih proizvoda, prihrana, vrcanja, serije meda,
            laboratorijski nalazi, pakiranja i skladište.
          </p>
          <p>
            <strong className="text-foreground">Dokumenti i fotografije:</strong> ono što sami
            učitate — rješenja, nalazi, računi, slike okvira. Ove datoteke znaju sadržavati OIB i
            kućnu adresu, pa se poslužuju isključivo kroz prijavljeni pristup i nikada kao javna
            datoteka.
          </p>
          <p>
            <strong className="text-foreground">Poslovni podaci:</strong> kupci (naziv, OIB, adresa,
            kontakt), prodaje, troškovi i potpore. Njima pristupa samo vlasnik gospodarstva.
          </p>
          <p>
            <strong className="text-foreground">Zapisnik izmjena:</strong> tko je i kada promijenio
            koji zapis. Bez toga evidencija koja se pokazuje inspekciji nema dokaznu vrijednost.
          </p>
        </Section>

        <Section title="Zašto ih čuva i na kojoj osnovi">
          <p>
            Podaci računa i evidencije obrađuju se radi izvršenja ugovora — to jest, da bi
            aplikacija radila ono zbog čega ste je otvorili (čl. 6. st. 1. t. b GDPR-a).
          </p>
          <p>
            Zapisnik izmjena i ograničenje broja pokušaja prijave temelje se na legitimnom interesu
            sigurnosti i vjerodostojnosti evidencije (t. f).
          </p>
          <p>
            Dio evidencije vodite jer to od vas traži propis — primjerice evidencija o primjeni
            veterinarsko-medicinskih proizvoda. Za te zapise pravna osnova je vaša zakonska obveza
            (t. c), a rok čuvanja određuje propis, ne aplikacija.
          </p>
        </Section>

        <Section title="Kome podaci odlaze">
          <p>
            Aplikacija nema oglase, analitiku ni pratitelje. Podaci se ne prodaju i ne ustupaju
            trećima u marketinške svrhe. Izvan poslužitelja odlaze samo u tri slučaja:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <strong className="text-foreground">Vremenska prognoza.</strong> Koordinate pčelinjaka
              šalju se servisu Open-Meteo kad zatražite prognozu. Šalje ih poslužitelj, ne vaš
              preglednik, i uz njih ne ide nijedan drugi podatak.
            </li>
            <li>
              <strong className="text-foreground">Glasovni unos.</strong> Ako ga uključite, snimka
              se šalje na transkripciju servisu Groq. Snimka se nigdje ne pohranjuje — obradi se i
              odbaci.
            </li>
            <li>
              <strong className="text-foreground">AI funkcije.</strong> Ako ih uključite, tekst
              pitanja, fotografija dokumenta ili transkript šalju se Anthropicu (Claude), zajedno s
              onim podacima gospodarstva koji su potrebni za odgovor. Fotografije se ne pohranjuju
              kod nas ni kod njih.
            </li>
          </ul>
          <p>
            Glasovni unos i AI funkcije su neobavezni i po zadanome isključeni. Bez njih aplikacija
            radi u cijelosti i ništa ne napušta poslužitelj.
          </p>
        </Section>

        <Section title="Javna stranica staklenke">
          <p>
            Ako sami uključite javni kod na deklaraciji, stranica koju kupac otvori pokazuje vrstu
            meda, godinu, seriju i naziv pčelara. Nikada ne pokazuje lokaciju pčelinjaka, OIB,
            kontakt, cijene niti ijedan učitani dokument. Uključivanje je vaša odluka i može se
            povući.
          </p>
        </Section>

        <Section title="Koliko dugo se čuvaju">
          <p>
            Dok imate račun. Nakon brisanja računa podaci koji vas identificiraju se uklanjaju, a
            zapisnik izmjena ostaje bez podataka koji upućuju na osobu, jer je on dokaz da je
            evidencija vođena.
          </p>
          <p>
            Sigurnosne kopije baze čuvaju se ograničeno vrijeme, pa podatak može postojati u kopiji
            i kratko nakon brisanja iz aplikacije.
          </p>
        </Section>

        <Section title="Kolačići">
          <p>
            Jedan, i nužan je: kolačić prijave. Nije dostupan skriptama, ne prati vas i ne šalje se
            drugim stranicama. Nema kolačića za analitiku ni oglašavanje, pa nema ni skočnog prozora
            koji traži pristanak.
          </p>
        </Section>

        <Section title="Vaša prava">
          <p>
            Imate pravo na pristup, ispravak, brisanje, ograničenje i prigovor, te pravo na
            prenosivost podataka. Dva su ugrađena u aplikaciju i ne trebate nikoga pitati:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong className="text-foreground">Preuzimanje svih podataka</strong> u strojno
              čitljivom obliku — <em>Moji podaci</em> u izborniku.
            </li>
            <li>
              <strong className="text-foreground">Brisanje računa</strong>, na istom mjestu.
            </li>
          </ul>
          <p>
            Podatke gospodarstva ispravljate sami na ekranu <em>Profil i gospodarstvo</em>. Ako
            smatrate da se podaci obrađuju protivno propisima, možete se obratiti Agenciji za
            zaštitu osobnih podataka (AZOP).
          </p>
        </Section>

        <Section title="Sigurnost">
          <p>
            Promet ide preko HTTPS-a, lozinke se čuvaju kao bcrypt sažetak i nikada u čitljivom
            obliku, a broj pokušaja prijave je ograničen. Fotografije i dokumenti nisu dostupni bez
            prijave. Baza i učitane datoteke se svakodnevno sigurnosno kopiraju.
          </p>
        </Section>

        <footer className="border-t border-border pt-6 text-sm">
          <Link to="/" className="text-primary underline-offset-4 hover:underline">
            Natrag na početnu
          </Link>
        </footer>
      </main>
    </div>
  )
}
