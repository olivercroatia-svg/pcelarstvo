import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { ApiError } from './http.js'
import { audioCostMicros, extract, record, type AiContext } from './ai.js'

/**
 * §13 — voice entry: "Pčelar govori, aplikacija zapisuje".
 *
 * Two steps, and the second one is where the quality actually comes from.
 *
 *   1. TRANSCRIBE. Claude has no audio input, so this is the layer's only non-Anthropic
 *      dependency. It sits behind `transcribe()` with the provider chosen by an environment
 *      variable, because the right answer here is a moving target: a hosted model is cheapest to
 *      run today, and a self-hosted one on the same VPS is the only version where the beekeeper's
 *      voice never leaves infrastructure we control (§56). Swapping is this file.
 *
 *   2. STRUCTURE, WITH THE FARM'S OWN VOCABULARY. A general transcriber hears "a-en nula četiri"
 *      and writes "an nula četiri"; it hears "matičnjak" and writes "matični jak". No transcription
 *      provider fixes that, because the words are specific to this beekeeper's hives and this
 *      beekeeper's medicine shelf. So the raw transcript is handed to Claude together with the
 *      actual hive codes, apiary names and VMP products read out of the database, and asked to map
 *      rather than to guess. This is why the transcription provider matters far less than it looks
 *      like it should.
 *
 * The result is a draft. §13 requires the confirmation step in as many words, and nothing here
 * writes to hive_inspections — the screen fills the ordinary form and the beekeeper presses save.
 */

// ── step 1: transcription ───────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
/** large-v3 rather than the cheaper turbo: Croatian accuracy is the whole reason this step exists. */
const GROQ_MODEL = 'whisper-large-v3'

/** 3 minutes of speech is already far more than one hive inspection; beyond it something is wrong. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 180

export interface Transcript {
  text: string
  seconds: number
}

/**
 * The provider seam. Everything above this line is provider-agnostic; everything a second provider
 * would need to change is below it.
 */
export async function transcribe(
  audio: Buffer,
  mimeType: string,
  filename: string,
): Promise<Transcript> {
  const provider = process.env.STT_PROVIDER ?? 'groq'
  if (provider !== 'groq') {
    throw new ApiError(503, `Nepoznat STT provider: ${provider}`, 'stt_unconfigured')
  }
  if (!process.env.GROQ_API_KEY) {
    throw new ApiError(503, 'Glasovni unos nije konfiguriran na poslužitelju.', 'stt_unconfigured')
  }

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename)
  form.append('model', GROQ_MODEL)
  // Croatian is pinned rather than auto-detected: a ten-second clip of one sentence is easy to
  // mistake for Serbian or Bosnian, and the wrong pick costs accuracy on exactly the endings that
  // distinguish "matica" from "matice".
  form.append('language', 'hr')
  // verbose_json is what carries `duration`, and duration is what the §007 ledger bills on.
  form.append('response_format', 'verbose_json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('[voice] transcription failed', response.status, detail.slice(0, 300))
      throw new ApiError(502, 'Prepoznavanje govora trenutno nije dostupno.', 'stt_unavailable')
    }
    const payload = (await response.json()) as { text?: string; duration?: number }
    const text = (payload.text ?? '').trim()
    if (!text) {
      throw new ApiError(422, 'U snimci nije prepoznat govor. Pokušajte ponovno.', 'stt_empty')
    }
    return { text, seconds: Math.round(payload.duration ?? 0) }
  } catch (err) {
    if (err instanceof ApiError) throw err
    console.error('[voice] transcription error', err)
    throw new ApiError(502, 'Prepoznavanje govora trenutno nije dostupno.', 'stt_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

// ── step 2: the farm's own vocabulary ───────────────────────────────────────

export interface Vocabulary {
  hives: { id: string; code: string; apiary: string }[]
  products: string[]
}

/**
 * Read fresh per request rather than cached. It is two small indexed queries, and a beekeeper who
 * has just added hive AN-17 expects to be able to dictate into it a minute later.
 */
export async function vocabulary(farmId: string): Promise<Vocabulary> {
  const [hives] = await pool.query<RowDataPacket[]>(
    `SELECT h.id, h.code, a.name AS apiary
       FROM hives h JOIN apiaries a ON a.id = h.apiary_id
      WHERE h.farm_id = ? AND h.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY a.name, h.code
      LIMIT 500`,
    [farmId],
  )
  const [products] = await pool.query<RowDataPacket[]>(
    `SELECT name FROM vmp_products WHERE farm_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 100`,
    [farmId],
  )
  return {
    hives: hives.map((h) => ({ id: h.id as string, code: h.code as string, apiary: h.apiary as string })),
    products: products.map((p) => p.name as string),
  }
}

// ── step 3: transcript → inspection draft ───────────────────────────────────

export interface InspectionDraft {
  hiveCode: string | null
  strength: 'weak' | 'medium' | 'strong' | 'very_strong' | null
  framesBees: number | null
  framesBrood: number | null
  brood: 'none' | 'little' | 'normal' | 'plenty' | null
  queenState: 'seen' | 'eggs' | 'not_found' | null
  swarming: 'none' | 'cells' | 'high_risk' | null
  queenCells: number | null
  stores: 'poor' | 'good' | 'excellent' | null
  notes: string | null
  unmatched: string[]
}

const nullableEnum = (values: string[]) => ({ type: ['string', 'null'], enum: [...values, null] })

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'hiveCode',
    'strength',
    'framesBees',
    'framesBrood',
    'brood',
    'queenState',
    'swarming',
    'queenCells',
    'stores',
    'notes',
    'unmatched',
  ],
  properties: {
    hiveCode: { type: ['string', 'null'] },
    strength: nullableEnum(['weak', 'medium', 'strong', 'very_strong']),
    framesBees: { type: ['integer', 'null'] },
    framesBrood: { type: ['integer', 'null'] },
    brood: nullableEnum(['none', 'little', 'normal', 'plenty']),
    queenState: nullableEnum(['seen', 'eggs', 'not_found']),
    swarming: nullableEnum(['none', 'cells', 'high_risk']),
    queenCells: { type: ['integer', 'null'] },
    stores: nullableEnum(['poor', 'good', 'excellent']),
    notes: { type: ['string', 'null'] },
    unmatched: { type: 'array', items: { type: 'string' } },
  },
}

/**
 * Turns one spoken sentence into the §12 inspection form.
 *
 * `hiveCode` is constrained to codes that exist on this farm, and the route resolves it back to an
 * id itself — the model names a hive, it never supplies one. Anything said that did not map to a
 * field goes into `notes` verbatim rather than being dropped, because a beekeeper who said
 * something out loud expects to find it in the record.
 */
export async function structureInspection(
  ctx: AiContext,
  transcript: string,
  vocab: Vocabulary,
  hint?: { code: string } | null,
): Promise<InspectionDraft> {
  const codes = vocab.hives.map((h) => `${h.code} (${h.apiary})`).join(', ') || '(nema unesenih košnica)'

  return extract<InspectionDraft>(ctx, {
    system: `Pretvaraš izgovorenu rečenicu hrvatskog pčelara u polja obrasca pregleda košnice.

Šifre košnica koje postoje na ovom gospodarstvu:
${codes}

Pravila:
- hiveCode mora biti TOČNO jedna od gornjih šifri ili null. Govorni zapis "a-en nula četiri",
  "an četiri" ili "an 4" odgovara šifri AN-04. Ako nijedna šifra ne odgovara pouzdano, vrati null.
- Za svako polje koje pčelar nije spomenuo vrati null. Ne izvodi jedno polje iz drugoga: "jaka
  zajednica" NE znači da je zaliha hrane dobra.
- Mapiranje pojmova:
  · snaga: slaba → weak, srednja → medium, jaka → strong, vrlo jaka → very_strong
  · leglo: nema → none, malo → little, uredno/normalno → normal, puno → plenty
  · matica: vidio sam maticu → seen, ima jaja/jajašca → eggs, nisam našao maticu → not_found
  · rojenje: nema znakova → none, ima matičnjaka → cells, sprema se rojiti → high_risk
  · hrana/zalihe: slabo → poor, dobro → good, puno → excellent
- framesBees je broj ulica/okvira posjednutih pčelama, framesBrood broj okvira legla,
  queenCells broj matičnjaka.
- notes: sve što je pčelar rekao a ne stane ni u jedno polje, prepisano njegovim riječima i
  očišćeno od poštapalica. Ako je sve stalo u polja, vrati null.
- unmatched: dijelovi rečenice koje nisi razumio, da ih korisnik provjeri.
- NIKADA ne izmišljaj brojeve. Ako je pčelar rekao "dosta legla" bez broja, brood je "plenty" a
  framesBrood ostaje null.`,
    prompt:
      (hint ? `Pčelar je skenirao košnicu ${hint.code} prije diktiranja.\n\n` : '') +
      `Izgovoreno:\n"""${transcript}"""`,
    schema: DRAFT_SCHEMA,
    // Mapping loose speech onto a closed vocabulary is interpretation, not transcription — `low`
    // here produced literal readings that dropped half the sentence into `unmatched`.
    effort: 'medium',
  })
}

/** Books the transcription leg of a voice entry. The structuring leg bills itself inside extract(). */
export async function recordTranscription(ctx: AiContext, seconds: number): Promise<void> {
  await record(ctx, {
    model: GROQ_MODEL,
    audioSeconds: seconds,
    costMicros: audioCostMicros(seconds),
  })
}
