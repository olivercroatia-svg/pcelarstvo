import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

interface LocationPickerProps {
  latitude: number | null
  longitude: number | null
  onChange: (lat: number, lon: number) => void
  readOnly?: boolean
}

// Croatia's rough centre — where the map opens when an apiary has no coordinates yet.
const DEFAULT_CENTER: [number, number] = [45.1, 15.9]

/**
 * Leaflet is driven imperatively rather than through react-leaflet here: the picker is one marker
 * and one click handler, and the wrapper's declarative lifecycle mostly gets in the way of
 * "recentre when the GPS returns" without re-mounting the tiles.
 *
 * The default marker icon is skipped entirely — its PNGs resolve badly under a subpath build, and
 * a divIcon carries the brand colour anyway.
 */
export function LocationPicker({ latitude, longitude, onChange, readOnly }: LocationPickerProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  // Kept in a ref so the click handler registered once always calls the latest callback.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!container.current || map.current) return

    const instance = L.map(container.current, { attributionControl: true }).setView(
      latitude !== null && longitude !== null ? [latitude, longitude] : DEFAULT_CENTER,
      latitude !== null ? 15 : 7,
    )

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(instance)

    if (!readOnly) {
      instance.on('click', (event: L.LeafletMouseEvent) => {
        onChangeRef.current(
          Number(event.latlng.lat.toFixed(7)),
          Number(event.latlng.lng.toFixed(7)),
        )
      })
    }

    map.current = instance
    // Leaflet measures the container on init; inside a form that is still laying out it can come
    // back zero and render a grey box until the next resize.
    setTimeout(() => instance.invalidateSize(), 0)

    return () => {
      instance.remove()
      map.current = null
      marker.current = null
    }
  }, [latitude, longitude, readOnly])

  useEffect(() => {
    const instance = map.current
    if (!instance) return

    if (latitude === null || longitude === null) {
      marker.current?.remove()
      marker.current = null
      return
    }

    const icon = L.divIcon({
      className: '',
      html: `<span style="display:block;width:22px;height:22px;border-radius:50%;
             background:var(--primary);border:3px solid var(--card);
             box-shadow:0 1px 6px rgba(0,0,0,.4)"></span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    })

    if (marker.current) {
      marker.current.setLatLng([latitude, longitude]).setIcon(icon)
    } else {
      marker.current = L.marker([latitude, longitude], { icon }).addTo(instance)
    }
    instance.setView([latitude, longitude], Math.max(instance.getZoom(), 15))
  }, [latitude, longitude])

  function useCurrentPosition() {
    if (!navigator.geolocation) {
      setGeoError('Uređaj ne podržava lociranje')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        onChange(
          Number(position.coords.latitude.toFixed(7)),
          Number(position.coords.longitude.toFixed(7)),
        )
      },
      (err) => {
        setLocating(false)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Pristup lokaciji je odbijen. Dopustite ga u postavkama preglednika.'
            : 'Lokaciju nije moguće odrediti. Označite je na karti.',
        )
      },
      // Standing in an apiary, a cached fix from town is worse than waiting a few seconds.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }

  return (
    <div className="space-y-2">
      <div
        ref={container}
        className="h-56 w-full overflow-hidden rounded-xl border border-border"
        // Leaflet's own panes sit at z-index 400+, which would otherwise punch through the bottom
        // navigation and any open dialog.
        style={{ zIndex: 0, position: 'relative' }}
      />

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={useCurrentPosition} disabled={locating}>
            {locating ? <LoaderCircle className="animate-spin" /> : <Crosshair />}
            {locating ? 'Tražim…' : 'Moja lokacija'}
          </Button>
          <p className="text-xs text-muted-foreground">ili dodirnite kartu</p>
        </div>
      )}

      {geoError && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {geoError}
        </p>
      )}

      {latitude !== null && longitude !== null && (
        <p className="tabular text-xs text-muted-foreground">
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </p>
      )}
    </div>
  )
}
