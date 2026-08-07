import { EXPENSE_CATEGORIES } from './commerce.js'
import { loadLabParameters } from './production.js'
import { extract, ask, type AiContext, type ImageInput } from './ai.js'

/**
 * Reading photographs (§18, §31, §39, §44).
 *
 * The scenario calls this OCR, and the word is worth correcting once here: none of this is
 * character recognition. The model is shown the photograph and asked for the *fields*, which is
 * why a crumpled receipt, a handwritten note in the margin and a Croatian date written 7.8.2026.
 * all land in the same shape. There is no OCR service, no second vendor, no template per supplier.
 *
 * Two rules run through every function below.
 *
 *   1. NULL RATHER THAN A GUESS. Every prompt says it and every schema allows it. A withdrawal
 *      period invented from a blurry box would sit in the §17 veterinary register looking exactly
 *      like one that was read, and the beekeeper would sell honey against it. An empty field is
 *      visibly empty; a wrong field is not.
 *
 *   2. WHAT COMES BACK IS A FORM, NOT A RECORD. Every one of these returns a draft that the
 *      existing screen renders as a filled-in form for the beekeeper to correct and save. §13
 *      demands the confirmation step for voice, and there is no honest reason to hold a
 *      photograph to a lower standard than a sentence.
 */

const nullableString = { type: ['string', 'null'] }
const nullableNumber = { type: ['number', 'null'] }

/** Shared preamble. Croatian conventions are stated because the documents are Croatian. */
const BASE_RULES = `
Čitaš fotografiju hrvatskog dokumenta i vraćaš polja.

Obavezna pravila:
- Ako polje nije jasno čitljivo, vrati null. NIKADA ne pogađaj i ne izvodi vrijednost iz konteksta.
- Datume vraćaj isključivo kao YYYY-MM-DD. Hrvatski zapis "7.8.2026." je "2026-08-07".
- Brojeve vraćaj s točkom kao decimalnim znakom: "12,50" je 12.5.
- Ne prevodi nazive proizvoda, laboratorija ni dobavljača — prepiši ih točno kako pišu.
`.trim()

// ─────────────────────────────────────────────────────────── §18 — VMP box

export interface VmpDraft {
  name: string | null
  activeSubstance: string | null
  manufacturer: string | null
  form: string | null
  withdrawalDays: number | null
  defaultDose: string | null
  defaultMethod: string | null
  unreadable: string[]
}

const VMP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'activeSubstance',
    'manufacturer',
    'form',
    'withdrawalDays',
    'defaultDose',
    'defaultMethod',
    'unreadable',
  ],
  properties: {
    name: nullableString,
    activeSubstance: nullableString,
    manufacturer: nullableString,
    form: nullableString,
    withdrawalDays: nullableNumber,
    defaultDose: nullableString,
    defaultMethod: nullableString,
    unreadable: { type: 'array', items: { type: 'string' } },
  },
}

/**
 * §18 — "skeniranje kutije lijeka". Fills the VMP product form from the packaging.
 *
 * `withdrawalDays` is the field this whole feature exists for and the one it is most careful with.
 * A box states karenca in several shapes ("karenca: 0 dana", "nema karence", "med se ne smije
 * vrcati tijekom tretiranja"), and only a stated number becomes a number. Anything else stays null
 * and the beekeeper types it, because §17's register is what an inspector reads.
 */
export async function readVmpLabel(ctx: AiContext, image: ImageInput): Promise<VmpDraft> {
  return extract<VmpDraft>(ctx, {
    system: `${BASE_RULES}

Dokument je kutija ili uputa veterinarsko-medicinskog proizvoda (VMP) za pčele.

- withdrawalDays je karenca u danima, i to samo ako je na kutiji izričito napisan broj dana.
  "Karenca: 0 dana" je 0. "Nema karence" je 0. Ako karenca nije navedena, vrati null — nemoj je
  zaključiti iz djelatne tvari.
- form je oblik: trakice, otopina, gel, dim, prašak, tablete.
- defaultDose je propisana doza po zajednici, defaultMethod način primjene.
- U "unreadable" nabroji hrvatskim nazivima polja koja si vidio na kutiji ali nisi mogao pouzdano
  pročitati, da korisnik zna gdje pogledati.`,
    prompt: 'Pročitaj podatke s ove kutije VMP-a.',
    images: [image],
    schema: VMP_SCHEMA,
  })
}

// ────────────────────────────────────────────────────── §31 — lab report

export interface LabDraft {
  laboratory: string | null
  reportNumber: string | null
  sampledOn: string | null
  testedOn: string | null
  values: Record<string, number | null>
  unreadable: string[]
}

/**
 * §31 — reading a laboratory finding.
 *
 * The parameter list is not hardcoded: it is read from lab_parameters, the same administrable
 * table §54's engine and the §31 screen use. So the model is asked for exactly the parameters this
 * installation knows how to evaluate, and adding a parameter in the admin screen teaches the
 * reader about it with no code change.
 *
 * It reads values only. The pass/fail verdict stays where it already is — lib/production.ts,
 * against the administrator's thresholds — because a model agreeing or disagreeing with a
 * regulatory limit is not a thing this application should ever ship.
 */
export async function readLabReport(ctx: AiContext, image: ImageInput): Promise<LabDraft> {
  const parameters = await loadLabParameters()

  const valueProperties: Record<string, unknown> = {}
  for (const p of parameters) valueProperties[p.code] = nullableNumber

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['laboratory', 'reportNumber', 'sampledOn', 'testedOn', 'values', 'unreadable'],
    properties: {
      laboratory: nullableString,
      reportNumber: nullableString,
      sampledOn: nullableString,
      testedOn: nullableString,
      values: {
        type: 'object',
        additionalProperties: false,
        required: parameters.map((p) => p.code),
        properties: valueProperties,
      },
      unreadable: { type: 'array', items: { type: 'string' } },
    },
  }

  const list = parameters
    .map((p) => `- ${p.code}: ${p.name}${p.unit ? ` (${p.unit})` : ''}`)
    .join('\n')

  return extract<LabDraft>(ctx, {
    system: `${BASE_RULES}

Dokument je laboratorijski nalaz analize meda.

Traženi parametri (vrati null za svaki koji nalaz ne sadrži):
${list}

- Vrijednost vrati u navedenoj mjernoj jedinici. Ako je nalaz izražen u drugoj jedinici, preračunaj
  i navedi to u "unreadable" kao upozorenje.
- Ne ocjenjuj je li nalaz zadovoljio kriterij — to radi aplikacija.
- sampledOn je datum uzorkovanja, testedOn datum analize; često je naveden samo jedan.`,
    prompt: 'Pročitaj podatke i izmjerene vrijednosti s ovog laboratorijskog nalaza.',
    images: [image],
    schema,
    // Raised from the default: a lab report is a dense table with units and footnotes, and reading
    // the right row for the right parameter is interpretation rather than transcription.
    effort: 'medium',
  })
}

// ──────────────────────────────────────────────────────── §39 — receipt

export interface ReceiptDraft {
  spentOn: string | null
  supplier: string | null
  description: string | null
  amount: number | null
  vatAmount: number | null
  category: string | null
  unreadable: string[]
}

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spentOn', 'supplier', 'description', 'amount', 'vatAmount', 'category', 'unreadable'],
  properties: {
    spentOn: nullableString,
    supplier: nullableString,
    description: nullableString,
    amount: nullableNumber,
    vatAmount: nullableNumber,
    category: { type: ['string', 'null'], enum: [...EXPENSE_CATEGORIES, null] },
    unreadable: { type: 'array', items: { type: 'string' } },
  },
}

/**
 * §39 — "fotografiranje računa". Fills the expense form from a photographed receipt.
 *
 * `amount` is the gross total, matching the expenses table's own definition ("gross, the figure on
 * the receipt"). Croatian receipts print the total under half a dozen different labels, so the
 * prompt names them rather than hoping the model recognises the layout.
 */
export async function readReceipt(ctx: AiContext, image: ImageInput): Promise<ReceiptDraft> {
  return extract<ReceiptDraft>(ctx, {
    system: `${BASE_RULES}

Dokument je hrvatski račun ili otpremnica.

- amount je UKUPAN iznos s PDV-om — onaj koji je pčelar platio. Na hrvatskim računima piše kao
  "UKUPNO", "ZA PLATITI", "Ukupan iznos" ili "Sveukupno". Ako je naveden i iznos bez PDV-a, njega
  ignoriraj.
- vatAmount je iznos PDV-a ako je iskazan zasebno, inače null. Većina malih pčelara nije u sustavu
  PDV-a pa ga račun često nema.
- Iznose vrati u eurima. Ako je račun u kunama, vrati null za amount i upiši "iznos u kunama" u
  "unreadable" — preračunavanje tečaja nije tvoj posao.
- category odaberi iz ponuđenog popisa prema tome što je kupljeno; ako nije jasno, vrati null.
- description je kratak opis kupljenog (najviše 10 riječi), ne prijepis cijelog računa.`,
    prompt: 'Pročitaj podatke s ovog računa.',
    images: [image],
    schema: RECEIPT_SCHEMA,
  })
}

// ──────────────────────────────────────────────── §44 — photo description

/**
 * §44 — a caption for a photo in the hive diary.
 *
 * The scenario is explicit that this must not diagnose, and that constraint is the feature's
 * defining property rather than a caveat on it. A model that says "ovo izgleda kao američka gnjiloća"
 * would be making a notifiable-disease call (§15) that in Croatia belongs to a veterinarian, and a
 * beekeeper who believed it either destroys healthy colonies or, far worse, is reassured by a
 * confident "izgleda zdravo" and does not call anyone.
 *
 * So the prompt asks for observation and forbids conclusion, and the screen repeats the same
 * sentence under the result. What the model may say is what a photograph plainly shows: how much
 * of the frame is capped, whether queen cells are visible, that there is pollen in the corners.
 */
export async function describePhoto(ctx: AiContext, image: ImageInput): Promise<string> {
  return ask(ctx, {
    system: `Opisuješ fotografiju iz pčelarskog dnevnika, na hrvatskom jeziku.

ŠTO SMIJEŠ: opisati što se na slici vidi — okvir, saće, poklopljeno i nepoklopljeno leglo, med,
pelud, matičnjake, broj i raspored, stanje opreme, okoliš pčelinjaka.

ŠTO NE SMIJEŠ, ni na izravno pitanje: postaviti dijagnozu bolesti, procijeniti zdravlje zajednice,
tvrditi da je nešto zdravo ili bolesno, ni predložiti liječenje. Ako na slici vidiš nešto neobično,
opiši kako to izgleda i time završi — bez zaključka što bi to moglo biti.

Piši jednu do dvije rečenice, najviše 200 znakova, bez uvoda i bez nabrajanja.`,
    prompt: 'Opiši ovu fotografiju za dnevnik.',
    images: [image],
    maxTokens: 2000,
  })
}
