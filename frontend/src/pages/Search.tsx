import { ArrowLeft, Search as SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate } from '@/lib/format'
import type { SearchResult } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * §52 — "Globalna tražilica … „B024", „kadulja", „Apivar", „2026-05", „LOT KAD-260524"".
 *
 * All five of those shapes are one input box. The server decides what a term means: a code, a
 * name, or a date range. The debounce is 300 ms — long enough not to fire a dozen fan-out queries
 * while someone types "kadulja", short enough that it feels instant.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [term, setTerm] = useState(initial)
  const [debounced, setDebounced] = useState(initial)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(term.trim())
      // Kept in the URL so a result can be shared, and so going back from a hit returns to the
      // same list rather than to an empty box.
      setParams(term.trim() ? { q: term.trim() } : {}, { replace: true })
    }, 300)
    return () => clearTimeout(timer)
  }, [term, setParams])

  const { data, error, loading } = useResource<SearchResult>(
    debounced.length >= 2 ? `/search?q=${encodeURIComponent(debounced)}` : null,
  )

  const hits = data?.hits ?? []
  const grouped = hits.reduce<Record<string, typeof hits>>((acc, hit) => {
    acc[hit.typeLabel] = [...(acc[hit.typeLabel] ?? []), hit]
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Traži</h1>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="B024, kadulja, Apivar, 2026-05, KAD-260524…"
          aria-label="Pojam za pretraživanje"
          className="pl-9"
        />
      </div>

      {debounced.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Upišite barem dva znaka. Traži se po košnicama, pčelinjacima, serijama, vrcanjima,
          tretmanima, maticama, dokumentima, skladištu, pašama i selidbama.
        </p>
      ) : loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : hits.length === 0 ? (
        <EmptyState icon={SearchIcon} title={`Ništa nije pronađeno za „${debounced}"`} />
      ) : (
        <div className="space-y-4">
          {data?.dateRange && (
            <p className="text-xs text-muted-foreground">Prikazani su i događaji iz razdoblja {data.dateRange}.</p>
          )}
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <Card>
                <CardContent className="py-1">
                  {items.map((hit) => (
                    <Link
                      key={`${hit.type}-${hit.id}`}
                      to={hit.link}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-1 hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                        )}
                      </span>
                      {hit.date && (
                        <span className="tabular shrink-0 text-xs text-muted-foreground">{formatDate(hit.date)}</span>
                      )}
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
