import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

interface QrCodeProps {
  value: string
  size?: number
  className?: string
}

export function QrCode({ value, size = 160, className }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, {
      width: size * 2, // rendered at 2× so it stays sharp on a phone screen and in print
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#201e1dff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (!dataUrl) {
    return <div className={className} style={{ width: size, height: size }} aria-hidden />
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt=""
      className={className}
      // Keeps the modules crisp instead of blurring them when the browser scales the bitmap.
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
