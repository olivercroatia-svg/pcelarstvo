import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §47 — the forecast for each apiary that has a GPS position.
 *
 * Proxied through the server rather than fetched from the browser, for two reasons that both come
 * from §56. The coordinates never leave the database: the client asks for an apiary by id and the
 * server looks the position up, so a compromised or simply curious browser extension cannot read
 * a beekeeper's apiary locations out of an outgoing request. And the request to Open-Meteo carries
 * the VPS's address, not the beekeeper's home IP.
 *
 * Open-Meteo needs no API key and has no cost, which is why it was chosen in the plan. The cache
 * is a plain Map keyed on rounded coordinates: several apiaries in the same valley share one
 * upstream call, and the whole thing evaporates on restart, which is the correct lifetime for
 * weather.
 *
 * Nothing here ever fails the request. §47 calls this "informativna pomoć" — if the upstream is
 * down the screen says so and the rest of the apiary card still renders.
 */
export const weatherRouter = Router()
weatherRouter.use(requireFarm)

const CACHE_MS = 30 * 60 * 1000
const cache = new Map<string, { at: number; data: WeatherData }>()

/** WMO weather interpretation codes, in the words a forecast would use. */
const WMO: Record<number, string> = {
  0: 'Vedro',
  1: 'Pretežno vedro',
  2: 'Djelomično oblačno',
  3: 'Oblačno',
  45: 'Magla',
  48: 'Magla s injem',
  51: 'Slaba rosulja',
  53: 'Rosulja',
  55: 'Jaka rosulja',
  56: 'Ledena rosulja',
  57: 'Jaka ledena rosulja',
  61: 'Slaba kiša',
  63: 'Kiša',
  65: 'Jaka kiša',
  66: 'Ledena kiša',
  67: 'Jaka ledena kiša',
  71: 'Slab snijeg',
  73: 'Snijeg',
  75: 'Jak snijeg',
  77: 'Snježna zrnca',
  80: 'Pljuskovi',
  81: 'Jaki pljuskovi',
  82: 'Vrlo jaki pljuskovi',
  85: 'Snježni pljuskovi',
  86: 'Jaki snježni pljuskovi',
  95: 'Grmljavina',
  96: 'Grmljavina s tučom',
  99: 'Jaka grmljavina s tučom',
}

interface WeatherData {
  current: {
    temperature: number
    humidity: number
    precipitation: number
    windSpeed: number
    code: number
    description: string
  }
  daily: {
    date: string
    min: number
    max: number
    precipitation: number
    windSpeed: number
    code: number
    description: string
  }[]
}

/**
 * §47's "Dobri uvjeti za pregled pčelinjaka".
 *
 * The thresholds are the ordinary field rule: bees are calm and most of the foragers are out when
 * it is warm, dry and still. Below 15 °C the colony clusters and opening it chills the brood;
 * above about 32 °C or in wind over 25 km/h the bees get defensive. Deliberately advisory wording
 * — the beekeeper is standing there and can see the sky.
 */
function inspectionAdvice(c: WeatherData['current']): { level: 'ok' | 'caution' | 'warning'; text: string } {
  if (c.precipitation > 0.2) return { level: 'warning', text: 'Kiša — pregled nije preporučljiv.' }
  if (c.temperature < 12) return { level: 'warning', text: 'Prehladno za otvaranje košnice.' }
  if (c.windSpeed > 25) return { level: 'caution', text: 'Jak vjetar — pčele su nemirnije.' }
  if (c.temperature < 15) return { level: 'caution', text: 'Hladno — pregled neka bude kratak.' }
  if (c.temperature > 32) return { level: 'caution', text: 'Vruće — pregled rano ujutro ili navečer.' }
  return { level: 'ok', text: 'Dobri uvjeti za pregled pčelinjaka.' }
}

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherData | null> {
  // Rounded to ~1 km: two apiaries on the same hill do not need two upstream calls, and the
  // cache key is then not a precise coordinate either.
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max' +
    '&timezone=Europe%2FZagreb&forecast_days=6'

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return null

    const json = (await response.json()) as {
      current: Record<string, number>
      daily: Record<string, (number | string)[]>
    }

    const code = Number(json.current.weather_code ?? 0)
    const data: WeatherData = {
      current: {
        temperature: Math.round(Number(json.current.temperature_2m)),
        humidity: Math.round(Number(json.current.relative_humidity_2m)),
        precipitation: Number(json.current.precipitation ?? 0),
        windSpeed: Math.round(Number(json.current.wind_speed_10m)),
        code,
        description: WMO[code] ?? 'Nepoznato',
      },
      daily: (json.daily.time as string[]).map((date, i) => {
        const dayCode = Number(json.daily.weather_code![i])
        return {
          date,
          min: Math.round(Number(json.daily.temperature_2m_min![i])),
          max: Math.round(Number(json.daily.temperature_2m_max![i])),
          precipitation: Number(json.daily.precipitation_sum![i] ?? 0),
          windSpeed: Math.round(Number(json.daily.wind_speed_10m_max![i])),
          code: dayCode,
          description: WMO[dayCode] ?? 'Nepoznato',
        }
      }),
    }

    cache.set(key, { at: Date.now(), data })
    return data
  } catch {
    // Timeout, DNS failure, upstream outage — all the same answer to the caller: no forecast
    // right now. Never a 500, because this sits on an apiary card that has to render regardless.
    return null
  }
}

weatherRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const { apiaryId } = z.object({ apiaryId: z.string().trim().min(1).optional() }).parse(req.query)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, latitude, longitude FROM apiaries
        WHERE farm_id = ? AND deleted_at IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
        ${apiaryId ? 'AND id = ?' : ''}
        ORDER BY name`,
      apiaryId ? [farmId, apiaryId] : [farmId],
    )

    if (apiaryId && rows.length === 0) {
      // Either the apiary does not exist or it has no coordinates. The second is not an error —
      // §9 makes the GPS position optional — so it is reported as a state, not a 404.
      const [exists] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL',
        [apiaryId, farmId],
      )
      if (exists.length === 0) throw notFound('Pčelinjak nije pronađen')
      res.json({ apiaries: [], missingLocation: true })
      return
    }

    const apiaries = await Promise.all(
      rows.map(async (row) => {
        const data = await fetchWeather(Number(row.latitude), Number(row.longitude))
        return {
          apiaryId: row.id as string,
          apiaryName: row.name as string,
          available: data !== null,
          current: data?.current ?? null,
          daily: data?.daily ?? [],
          advice: data ? inspectionAdvice(data.current) : null,
        }
      }),
    )

    res.json({ apiaries, missingLocation: false })
  }),
)
