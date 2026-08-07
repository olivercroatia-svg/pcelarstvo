import Anthropic from '@anthropic-ai/sdk'
import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { ApiError } from './http.js'
import { newId } from './ids.js'

/**
 * The AI layer's single entry point (§13, §18, §31, §39, §44, §45, §46).
 *
 * Everything that talks to a model goes through `ask()` or `extract()` below, and both of them
 * refuse to run until the farm's spend for the month has been checked. That ordering is the whole
 * point of this file: a model endpoint is the only thing in this application that turns a request
 * into money, and Etapa 6 puts it behind a public registration form.
 *
 * The layer is designed to be *absent* rather than broken when it is not configured. No API key,
 * an administrator's switch turned off, a provider outage — each of those has to leave a beekeeper
 * with an application that still records an inspection, still prints a declaration and still shows
 * the obligations. Nothing here is allowed to become a dependency of the register.
 */

// ── the model, and what it costs ────────────────────────────────────────────
//
// Prices are facts about a vendor, not decisions this application makes, so they live here rather
// than in the administrable ai_settings table. They are USD per million tokens, from the Anthropic
// pricing page.
//
// ⚠️  claude-sonnet-5 is on introductory pricing of $2/$10 through 2026-08-31, after which it goes
//     to $3/$15. The higher figure is used below on purpose: a cap computed with tomorrow's price
//     stops slightly early today, and stopping early is the safe direction for a spending limit.

export const MODEL = 'claude-sonnet-5'

const USD_PER_MTOK_IN = 3.0
const USD_PER_MTOK_OUT = 15.0
/** Cache reads bill at a tenth of the input rate; writes at 1,25× for the default 5-minute TTL. */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

/**
 * Groq, whisper-large-v3 (§13). Billed per hour of audio, not per token.
 *
 * ⚠️  Verify against groq.com/pricing before go-live. Deliberately rounded up: this figure only
 *     feeds the spending cap, and over-estimating makes the cap conservative.
 */
const USD_PER_AUDIO_HOUR = 0.12

/**
 * Used to express the cap in euros, because every other figure the beekeeper sees in this
 * application is in euros (§37–§40) and a budget in a second currency is a budget nobody reads.
 * An approximation for budgeting, not an accounting rate — the real invoice arrives in USD.
 */
const USD_TO_EUR = 0.92

const MICROS = 1_000_000

export type AiFeature =
  | 'assistant'
  | 'summary'
  | 'voice'
  | 'ocr_vmp'
  | 'ocr_lab'
  | 'ocr_receipt'
  | 'photo'
  | 'transcribe'

export interface AiContext {
  farmId: string
  userId: string | null
  feature: AiFeature
  canViewCost?: boolean
}

// ── client ──────────────────────────────────────────────────────────────────

let client: Anthropic | null = null

/**
 * Built on first use rather than at import time. The backend has to boot and serve every
 * non-AI route on a host that has no ANTHROPIC_API_KEY — that is the state of the development
 * machine right now, and it must not be a crash.
 */
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(503, 'AI funkcije nisu konfigurirane na poslužitelju.', 'ai_unconfigured')
  }
  client ??= new Anthropic()
  return client
}

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// ── administrable policy (ai_settings) ──────────────────────────────────────

interface Settings {
  enabled: boolean
  assistantEnabled: boolean
  dailySummaryEnabled: boolean
  monthlyCapMicros: number
}

let cache: { at: number; value: Settings } | null = null
const SETTINGS_TTL_MS = 60_000

/**
 * Cached for a minute. An administrator flipping the kill switch during a cost incident should not
 * have to wait for a deploy, but neither should every model call cost an extra round trip to
 * MySQL — a minute is the compromise, and it is the same order of delay as noticing the incident.
 */
export async function settings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < SETTINGS_TTL_MS) return cache.value

  const [rows] = await pool.query<RowDataPacket[]>('SELECT setting_key, value FROM ai_settings')
  const map = new Map(rows.map((r) => [r.setting_key as string, r.value as string]))
  const capEur = Number(map.get('monthly_cap_eur') ?? '0')

  const value: Settings = {
    enabled: map.get('enabled') !== 'false',
    assistantEnabled: map.get('assistant_enabled') !== 'false',
    dailySummaryEnabled: map.get('daily_summary_enabled') !== 'false',
    // 0 means "no limit"; anything unparseable is treated as 0 rather than as a cap of zero, which
    // would silently disable the layer on a typo.
    monthlyCapMicros: Number.isFinite(capEur) ? Math.round(capEur * MICROS) : 0,
  }
  cache = { at: Date.now(), value }
  return value
}

/** Called by the admin route after an update, so the change is visible immediately. */
export function invalidateSettings(): void {
  cache = null
}

// ── the spend ledger ────────────────────────────────────────────────────────

export interface Spend {
  /** Micro-euros consumed since the first of the current month. */
  usedMicros: number
  capMicros: number
  /** False once the cap is reached; always true when the cap is 0. */
  allowed: boolean
}

/** First day of the current month, as a MySQL DATETIME the index can range-scan on. */
function monthStart(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`
}

export async function spend(farmId: string): Promise<Spend> {
  const { monthlyCapMicros } = await settings()
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COALESCE(SUM(cost_micros), 0) AS used FROM ai_usage WHERE farm_id = ? AND created_at >= ?',
    [farmId, monthStart()],
  )
  const usedMicros = Number(rows[0]?.used ?? 0)
  return {
    usedMicros,
    capMicros: monthlyCapMicros,
    allowed: monthlyCapMicros === 0 || usedMicros < monthlyCapMicros,
  }
}

/**
 * The gate. Runs before every request that costs money, including each iteration of the
 * assistant's tool loop — a loop that re-checks only at the start is a loop that can spend the
 * month's budget in one conversation.
 */
export async function guard(ctx: AiContext): Promise<void> {
  const s = await settings()
  if (!s.enabled) {
    throw new ApiError(503, 'AI funkcije su privremeno isključene.', 'ai_disabled')
  }
  if (ctx.feature === 'assistant' && !s.assistantEnabled) {
    throw new ApiError(503, 'AI asistent je privremeno isključen.', 'ai_disabled')
  }
  if (!isConfigured()) {
    throw new ApiError(503, 'AI funkcije nisu konfigurirane na poslužitelju.', 'ai_unconfigured')
  }

  const { allowed, usedMicros, capMicros } = await spend(ctx.farmId)
  if (!allowed) {
    const detail = ctx.canViewCost
      ? ` (${(usedMicros / MICROS).toFixed(2)} € od ${(capMicros / MICROS).toFixed(2)} €)`
      : ''
    throw new ApiError(
      429,
      `Mjesečni limit AI funkcija je dosegnut${detail}. ` +
        'Ostatak aplikacije radi normalno, a limit se obnavlja prvog u mjesecu.',
      'ai_cap_reached',
    )
  }
}

interface TokenUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function costMicros(usage: TokenUsage): number {
  const input = Number(usage.input_tokens ?? 0)
  const output = Number(usage.output_tokens ?? 0)
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0)

  const usd =
    ((input + cacheRead * CACHE_READ_MULTIPLIER + cacheWrite * CACHE_WRITE_MULTIPLIER) /
      1_000_000) *
      USD_PER_MTOK_IN +
    (output / 1_000_000) * USD_PER_MTOK_OUT

  return Math.round(usd * USD_TO_EUR * MICROS)
}

export function audioCostMicros(seconds: number): number {
  return Math.round((seconds / 3600) * USD_PER_AUDIO_HOUR * USD_TO_EUR * MICROS)
}

/**
 * Append-only. Deliberately swallows its own errors, for the same reason lib/audit.ts does: a
 * ledger insert failing must not turn a successful answer into a 500 the user sees. A missing row
 * under-counts the month; a thrown error loses the work that was already paid for.
 */
export async function record(
  ctx: AiContext,
  entry: {
    model: string
    usage?: TokenUsage
    audioSeconds?: number
    costMicros: number
    ok?: boolean
    errorCode?: string | null
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_usage
         (id, farm_id, user_id, feature, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, audio_seconds, cost_micros, ok, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        ctx.farmId,
        ctx.userId,
        ctx.feature,
        entry.model,
        Number(entry.usage?.input_tokens ?? 0),
        Number(entry.usage?.output_tokens ?? 0),
        Number(entry.usage?.cache_read_input_tokens ?? 0),
        Number(entry.usage?.cache_creation_input_tokens ?? 0),
        Math.round(entry.audioSeconds ?? 0),
        entry.costMicros,
        entry.ok ?? true,
        entry.errorCode ?? null,
      ],
    )
  } catch (err) {
    console.error('[ai] failed to record usage', ctx.feature, err)
  }
}

// ── calling the model ───────────────────────────────────────────────────────

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ImageInput {
  base64: string
  mediaType: ImageMediaType
}

/**
 * One-shot structured extraction — the shape behind every OCR path (§18, §31, §39) and behind
 * turning a spoken sentence into fields (§13).
 *
 * `output_config.format` is what makes this safe to build a form from: the response is validated
 * against the schema server-side, so the route never has to cope with prose where it expected an
 * object. The alternative — asking for JSON in the prompt and hoping — is the failure this feature
 * exists to avoid.
 *
 * Effort is `low` by default. Reading fields off a photograph is not an intelligence-sensitive
 * task, and Claude Sonnet 5 respects the low setting strictly; raise it per call where a document
 * genuinely needs interpreting rather than transcribing.
 */
export async function extract<T>(
  ctx: AiContext,
  opts: {
    system: string
    prompt: string
    images?: ImageInput[]
    schema: Record<string, unknown>
    maxTokens?: number
    effort?: 'low' | 'medium' | 'high'
  },
): Promise<T> {
  await guard(ctx)

  const content: Anthropic.ContentBlockParam[] = []
  for (const image of opts.images ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    })
  }
  content.push({ type: 'text', text: opts.prompt })

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      // Generous on purpose: on Claude Sonnet 5 max_tokens caps thinking *and* the answer
      // together, so a tight budget sized to the JSON alone truncates mid-object.
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      output_config: {
        effort: opts.effort ?? 'low',
        format: { type: 'json_schema', schema: opts.schema },
      },
      messages: [{ role: 'user', content }],
    })

    await record(ctx, { model: MODEL, usage: response.usage, costMicros: costMicros(response.usage) })

    if (response.stop_reason === 'refusal') {
      throw new ApiError(422, 'Model je odbio obraditi ovu sliku.', 'ai_refusal')
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ApiError(422, 'Odgovor je predugačak za obradu. Pokušajte s izrezanijom slikom.', 'ai_truncated')
    }

    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') {
      throw new ApiError(422, 'Model nije vratio čitljiv odgovor.', 'ai_empty')
    }
    return JSON.parse(text.text) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    await record(ctx, {
      model: MODEL,
      costMicros: 0,
      ok: false,
      errorCode: err instanceof Error ? err.name : 'unknown',
    })
    console.error('[ai] extract failed', ctx.feature, err)
    throw new ApiError(502, 'AI servis trenutno nije dostupan. Pokušajte ponovno.', 'ai_unavailable')
  }
}

/** Plain prose answer, no tools, no schema — used by the §46 daily summary and §44 photo caption. */
export async function ask(
  ctx: AiContext,
  opts: {
    system: string
    prompt: string
    images?: ImageInput[]
    maxTokens?: number
    effort?: 'low' | 'medium' | 'high'
  },
): Promise<string> {
  await guard(ctx)

  const content: Anthropic.ContentBlockParam[] = []
  for (const image of opts.images ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    })
  }
  content.push({ type: 'text', text: opts.prompt })

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      output_config: { effort: opts.effort ?? 'low' },
      messages: [{ role: 'user', content }],
    })

    await record(ctx, { model: MODEL, usage: response.usage, costMicros: costMicros(response.usage) })

    if (response.stop_reason === 'refusal') {
      throw new ApiError(422, 'Model je odbio odgovoriti na ovaj zahtjev.', 'ai_refusal')
    }
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
  } catch (err) {
    if (err instanceof ApiError) throw err
    await record(ctx, {
      model: MODEL,
      costMicros: 0,
      ok: false,
      errorCode: err instanceof Error ? err.name : 'unknown',
    })
    console.error('[ai] ask failed', ctx.feature, err)
    throw new ApiError(502, 'AI servis trenutno nije dostupan. Pokušajte ponovno.', 'ai_unavailable')
  }
}

// ── the tool loop behind §45 ────────────────────────────────────────────────

export interface AiTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (input: Record<string, unknown>) => Promise<unknown>
}

export interface ToolCall {
  name: string
  input: Record<string, unknown>
}

export interface ConversationResult {
  text: string
  trace: ToolCall[]
}

/** Hard stop on the loop. Ten round trips is far more than any question here needs. */
const MAX_TURNS = 10

/**
 * Runs the assistant's tool loop by hand rather than through the SDK's tool runner.
 *
 * The runner is a beta surface, and this is the one code path in the application where an
 * unbounded loop spends money — so the loop is written out, the cap is re-checked on every
 * iteration, and every turn's tokens are booked to the ledger as they are consumed rather than at
 * the end. If the cap is reached mid-conversation the loop stops and returns what it has, which is
 * a partial answer; the alternative is a conversation that keeps buying turns after the budget is
 * gone.
 *
 * Tools are supplied by the caller and every one of them closes over req.farm.id. The model
 * chooses *which* tool to call and with what arguments, and never which farm — tool input is
 * untrusted model output, exactly like a request body.
 */
export async function converse(
  ctx: AiContext,
  opts: {
    system: string
    messages: Anthropic.MessageParam[]
    tools: AiTool[]
    maxTokens?: number
    effort?: 'low' | 'medium' | 'high' | 'xhigh'
  },
): Promise<ConversationResult> {
  await guard(ctx)

  const definitions: Anthropic.ToolUnion[] = opts.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }))
  const byName = new Map(opts.tools.map((tool) => [tool.name, tool]))

  const messages = [...opts.messages]
  const trace: ToolCall[] = []
  let text = ''

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      // Re-check on every iteration, not only the first. See the note above.
      if (turn > 0) {
        const { allowed } = await spend(ctx.farmId)
        if (!allowed) {
          text += '\n\n_Odgovor je prekinut jer je dosegnut mjesečni limit AI funkcija._'
          break
        }
      }

      const response = await anthropic().messages.create({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        output_config: { effort: opts.effort ?? 'medium' },
        tools: definitions,
        messages,
      })

      await record(ctx, {
        model: MODEL,
        usage: response.usage,
        costMicros: costMicros(response.usage),
      })

      if (response.stop_reason === 'refusal') {
        throw new ApiError(422, 'Model je odbio odgovoriti na ovo pitanje.', 'ai_refusal')
      }

      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()

      const calls = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )
      if (calls.length === 0) break

      messages.push({ role: 'assistant', content: response.content })

      // All results go back in ONE user message. Splitting them across several teaches the model
      // to stop making parallel calls, which is the opposite of what a "how did last season go"
      // question needs.
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const call of calls) {
        const tool = byName.get(call.name)
        const input = (call.input ?? {}) as Record<string, unknown>
        trace.push({ name: call.name, input })

        if (!tool) {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: `Alat "${call.name}" ne postoji.`,
            is_error: true,
          })
          continue
        }
        try {
          const output = await tool.run(input)
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(output),
          })
        } catch (err) {
          // Returned as a tool result rather than thrown: the model can recover from "that hive
          // code does not exist" by asking a better question, and a thrown error just loses the
          // conversation.
          console.error('[ai] tool failed', call.name, err)
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: err instanceof Error ? err.message : 'Alat nije uspio.',
            is_error: true,
          })
        }
      }
      messages.push({ role: 'user', content: results })
    }

    return { text, trace }
  } catch (err) {
    if (err instanceof ApiError) throw err
    await record(ctx, {
      model: MODEL,
      costMicros: 0,
      ok: false,
      errorCode: err instanceof Error ? err.name : 'unknown',
    })
    console.error('[ai] converse failed', err)
    throw new ApiError(502, 'AI servis trenutno nije dostupan. Pokušajte ponovno.', 'ai_unavailable')
  }
}

/** €, for display. The ledger is integers; only the screen sees a decimal. */
export const toEur = (micros: number): number => micros / MICROS
