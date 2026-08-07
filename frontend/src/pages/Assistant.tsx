import { ArrowLeft, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { Disclaimer } from '@/components/ui/disclaimer'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import {
  TOOL_LABELS,
  useAiStatus,
  type AssistantAnswer,
  type AssistantMessage,
  type Conversation,
} from '@/lib/ai'
import { formatDateTime } from '@/lib/format'
import { useResource } from '@/lib/useResource'

/**
 * §45 — the assistant, over the beekeeper's own records.
 *
 * Two things are deliberate on this screen. The tool trace is shown under every answer, because
 * "gdje je to pisalo" is the first question anyone asks an assistant that quotes a number back at
 * them — and here the honest answer is available. And the §55 disclaimer sits at the bottom of
 * the thread rather than in a corner: this reads like a conversation, and a conversation is
 * exactly where someone starts treating an answer as advice.
 */
export function AssistantPage() {
  const { status, loading: statusLoading } = useAiStatus()
  const { showError } = useToast()
  const confirm = useConfirm()

  const { data, reload } = useResource<{ conversations: Conversation[] }>('/assistant')
  const [openId, setOpenId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function open(id: string) {
    setOpenId(id)
    setMessages([])
    try {
      const thread = await api<{ messages: AssistantMessage[] }>(`/assistant/${id}`)
      setMessages(thread.messages)
    } catch {
      showError('Razgovor nije moguće otvoriti')
    }
  }

  async function send() {
    const text = question.trim()
    if (text.length < 2 || sending) return
    setSending(true)
    // Shown immediately so the thread does not sit empty while the tools run — but only in local
    // state. Nothing is written server-side until there is an answer to write beside it.
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, tools: [], createdAt: new Date().toISOString() },
    ])
    setQuestion('')
    try {
      const answer = await api<AssistantAnswer>('/assistant', {
        method: 'POST',
        body: { conversationId: openId, question: text },
      })
      setOpenId(answer.conversationId)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: answer.answer,
          tools: answer.tools,
          createdAt: new Date().toISOString(),
        },
      ])
      void reload()
    } catch (err) {
      // The optimistic question is rolled back: leaving it on screen after a failure makes it look
      // like it was asked and ignored.
      setMessages((prev) => prev.slice(0, -1))
      setQuestion(text)
      showError(err instanceof ApiError ? err.message : 'Odgovor nije stigao')
    } finally {
      setSending(false)
    }
  }

  async function remove(id: string, title: string) {
    const ok = await confirm({
      title: 'Obrisati razgovor?',
      description: `„${title}" će biti trajno uklonjen. Zapisi u evidenciji ostaju netaknuti.`,
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    await api(`/assistant/${id}`, { method: 'DELETE' })
    if (openId === id) {
      setOpenId(null)
      setMessages([])
    }
    void reload()
  }

  const header = (
    <div className="flex items-center gap-2">
      <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-5" />
      </Link>
      <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Asistent</h1>
      {openId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpenId(null)
            setMessages([])
          }}
        >
          <MessageSquarePlus />
          Novi
        </Button>
      )}
    </div>
  )

  if (!statusLoading && !status.assistant) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        {header}
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              AI asistent nije dostupan na ovoj instalaciji. Sve podatke i dalje možete pretraživati
              preko <Link to="/trazi" className="text-primary underline">pretrage</Link> i{' '}
              <Link to="/dnevnik" className="text-primary underline">dnevnika</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3">
      {header}

      {status.capReached && (
        <p className="rounded-lg bg-caution/10 p-3 text-sm text-caution">
          Mjesečni limit AI funkcija je dosegnut. Obnavlja se prvog u mjesecu; ostatak aplikacije
          radi normalno.
        </p>
      )}

      {!openId && (
        <>
          <Card>
            <CardContent className="space-y-2 pt-4">
              <p className="text-sm text-muted-foreground">
                Pitajte bilo što o svojim zapisima — asistent čita samo vašu evidenciju.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Koje košnice nisu pregledane više od mjesec dana?',
                  'Kada sam zadnji put tretirao i do kada traje karenca?',
                  'Koliko sam meda izvrcao ove godine po pašama?',
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuestion(s)}
                    className="min-h-11 rounded-lg border border-border px-2.5 text-left text-xs hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {data && data.conversations.length > 0 ? (
            <Card>
              <CardContent className="space-y-1 pt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Prijašnji razgovori
                </p>
                {data.conversations.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void open(c.id)}
                      className="min-h-11 min-w-0 flex-1 rounded-lg px-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="block truncate">{c.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(c.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Obriši ${c.title}`}
                      onClick={() => void remove(c.id, c.title)}
                      className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            data && (
              <EmptyState
                icon={Sparkles}
                title="Još nema razgovora"
                description="Postavite prvo pitanje o svojim košnicama, vrcanjima ili obvezama."
              />
            )
          )}
        </>
      )}

      {openId !== null && (
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={`${m.createdAt}-${i}`}
              className={
                m.role === 'user'
                  ? 'ml-8 rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground'
                  : 'mr-4 rounded-xl border border-border bg-card px-3 py-2 text-sm'
              }
            >
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {m.tools.length > 0 && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Wrench className="size-3" aria-hidden />
                  {/* Deduped: the model often calls the same tool twice in one answer, and
                      "povijest košnice, povijest košnice" says nothing extra. */}
                  čitano: {[...new Set(m.tools)].map((t) => TOOL_LABELS[t] ?? t).join(', ')}
                </p>
              )}
            </div>
          ))}
          {sending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Čitam evidenciju…
            </p>
          )}
          <div ref={bottom} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
        className="sticky bottom-2 flex gap-2 rounded-xl border border-border bg-card p-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pitajte o svojim zapisima…"
          aria-label="Pitanje"
          disabled={sending || status.capReached}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
        />
        <Button type="submit" size="icon" aria-label="Pošalji" disabled={sending || question.trim().length < 2}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>

      <Disclaimer text="Asistent čita samo vašu evidenciju i može pogriješiti. Ne postavlja dijagnoze bolesti i ne tumači propise — za to se obratite veterinaru odnosno nadležnom tijelu." />
    </div>
  )
}
