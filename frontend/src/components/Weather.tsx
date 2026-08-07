import { CloudRain, Droplets, Thermometer, Wind } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeatherApiary } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']

/**
 * §47 — the forecast for one apiary.
 *
 * Fetched by apiary id, never by coordinates: the browser does not know where the apiary is and
 * does not need to. The server looks the position up and calls Open-Meteo itself (§56).
 *
 * Renders nothing at all when the apiary has no GPS position or the upstream is unreachable. A
 * weather card is a convenience on someone else's card, and an error box where the forecast should
 * be is worse than no forecast.
 */
export function Weather({ apiaryId }: { apiaryId: string }) {
  const { data, loading } = useResource<{ apiaries: WeatherApiary[]; missingLocation: boolean }>(
    `/weather?apiaryId=${apiaryId}`,
  )

  if (loading) return null
  const weather = data?.apiaries?.[0]
  if (!weather || !weather.available || !weather.current) return null

  const { current, advice } = weather

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Vrijeme</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-3xl font-bold">{current.temperature} °C</span>
          <span className="text-sm text-muted-foreground">{current.description}</span>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Metric icon={Wind} label="Vjetar" value={`${current.windSpeed} km/h`} />
          <Metric icon={Droplets} label="Vlaga" value={`${current.humidity} %`} />
          <Metric
            icon={CloudRain}
            label="Oborine"
            value={current.precipitation > 0 ? `${current.precipitation} mm` : 'bez kiše'}
          />
        </dl>

        {advice && (
          <p
            className={cn(
              'rounded-lg p-2.5 text-sm',
              advice.level === 'ok' && 'bg-ok/10 text-ok',
              advice.level === 'caution' && 'bg-caution/10 text-caution',
              advice.level === 'warning' && 'bg-warning/10 text-warning',
            )}
          >
            {advice.text}
          </p>
        )}

        {weather.daily.length > 1 && (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {weather.daily.slice(1).map((day) => (
              <li key={day.date} className="min-w-16 shrink-0 rounded-lg bg-secondary p-2 text-center">
                <p className="text-xs text-muted-foreground">
                  {WEEKDAYS[new Date(`${day.date}T00:00:00`).getDay()]}
                </p>
                <p className="tabular text-sm font-semibold">{day.max}°</p>
                <p className="tabular text-xs text-muted-foreground">{day.min}°</p>
                {day.precipitation > 0 && (
                  <p className="tabular text-[10px] text-info">{day.precipitation} mm</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          Vremenski podaci su informativna pomoć (Open-Meteo).
        </p>
      </CardContent>
    </Card>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Thermometer
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="tabular font-medium">{value}</dd>
      </span>
    </div>
  )
}
