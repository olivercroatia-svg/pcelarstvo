import { useEffect, useState } from 'react'
import { ApiError } from './api'

/**
 * The client half of the AI layer (§13, §18, §31, §39, §44–§46).
 *
 * One rule shapes every screen that uses this: ASK BEFORE YOU DRAW. `useAiStatus()` is consulted
 * before a microphone or a camera button is rendered, so an installation with no API key, an
 * administrator's switch turned off, or a farm that has spent its month simply does not show the
 * affordance. Offering a button that answers 503 wastes the beekeeper's time twice — once tapping
 * it and once reading why.
 */

export interface AiStatus {
  available: boolean
  assistant: boolean
  voice: boolean
  capReached: boolean
  /** §4 — present only for an owner. A worker's response carries no euro figure at all. */
  usedEur?: number
  capEur?: number
}

const UNAVAILABLE: AiStatus = { available: false, assistant: false, voice: false, capReached: false }

/**
 * Deliberately not `useResource`: this is polled by half a dozen screens, it never changes within
 * a session in any way the user causes, and a failure has to read as "no AI" rather than as an
 * error banner over a working register.
 */
export function useAiStatus(): { status: AiStatus; loading: boolean } {
  const [status, setStatus] = useState<AiStatus>(UNAVAILABLE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetch(`${import.meta.env.BASE_URL}api/ai/status`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : UNAVAILABLE))
      .then((value) => live && setStatus(value as AiStatus))
      .catch(() => live && setStatus(UNAVAILABLE))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  return { status, loading }
}

/**
 * Multipart POST. Not routed through lib/api for the same reason uploadPhoto is not: that helper
 * sets a JSON content type, and multipart needs the browser to generate its own boundary.
 *
 * Errors are rethrown as ApiError so a screen can tell "the month's budget is gone"
 * (`ai_cap_reached`) from "the provider is down" (`ai_unavailable`) and say something different.
 */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    })
  } catch {
    throw new ApiError(0, 'Nema veze s poslužiteljem.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload?.error as string | undefined) ?? 'Obrada nije uspjela',
      payload?.fields as Record<string, string> | undefined,
      payload?.code as string | undefined,
    )
  }
  return payload as T
}

// ── §18 / §31 / §39 / §44 — what comes back from a photograph ───────────────

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

export interface LabDraft {
  laboratory: string | null
  reportNumber: string | null
  sampledOn: string | null
  testedOn: string | null
  values: Record<string, number | null>
  unreadable: string[]
}

export interface ReceiptDraft {
  spentOn: string | null
  supplier: string | null
  description: string | null
  amount: number | null
  vatAmount: number | null
  category: string | null
  unreadable: string[]
}

// ── §13 — what comes back from a spoken sentence ────────────────────────────

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

export interface VoiceResult {
  transcript: string
  seconds: number
  draft: InspectionDraft
  hive: { id: string; code: string; apiary: string } | null
}

// ── §45 — the assistant ─────────────────────────────────────────────────────

export interface Conversation {
  id: string
  title: string
  updatedAt: string
}

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
  tools: string[]
  createdAt: string
}

export interface AssistantAnswer {
  conversationId: string
  title: string
  answer: string
  tools: string[]
}

/** Tool names are English identifiers; these are what the trace shows the beekeeper. */
export const TOOL_LABELS: Record<string, string> = {
  farm_overview: 'pregled gospodarstva',
  list_hives: 'popis košnica',
  hive_history: 'povijest košnice',
  production: 'vrcanja i serije',
  obligations: 'zakonske obveze',
  treatments: 'tretmani i karence',
  economics: 'ekonomika',
}

// ── the meter (owner only) ──────────────────────────────────────────────────

export interface AiUsage {
  usedEur: number
  capEur: number
  capReached: boolean
  breakdown: { feature: string; label: string; calls: number; failures: number; eur: number }[]
}

/**
 * The one sentence every AI screen shows under its result. §55's disclaimer covers regulation;
 * this covers the model, and the two are different promises.
 */
export const AI_DISCLAIMER =
  'Ovo je prijedlog koji je pripremio AI model. Provjerite svaki podatak prije spremanja — u ' +
  'evidenciju ulazi samo ono što potvrdite.'
