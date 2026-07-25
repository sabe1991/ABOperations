// 天気アイコン（絵文字の代わりに使う線画アイコン・ユーザー要望）。
// 朝刊(新聞紙面)デザインに合わせ、色付きの絵文字ではなく currentColor（親の文字色）で描く
// モノクロの線画にする。SVG を自前で持つので外部フォント・画像に依存せず、CSP でも問題ない。
// 図案は Lucide（MIT ライセンスのアイコン集）の天気アイコンに準拠した 24×24・線幅ベースの形。
import type { ReactElement } from 'react'

// アイコンの種類。WMO 天気コードをこの少数のカテゴリに寄せて描き分ける。
export type WeatherIconName =
  | 'sun' // 快晴・晴れ
  | 'partly' // 一部くもり（日差し＋雲）
  | 'cloud' // くもり
  | 'fog' // 霧
  | 'drizzle' // 霧雨
  | 'rain' // 雨・にわか雨
  | 'snow' // 雪
  | 'thunder' // 雷雨

// WMO 天気コード → アイコン名。api.ts の weatherCodeInfo（絵文字＋日本語ラベル）と対応させる。
export function weatherIconName(code: number): WeatherIconName {
  switch (code) {
    case 0:
    case 1:
      return 'sun'
    case 2:
      return 'partly'
    case 3:
      return 'cloud'
    case 45:
    case 48:
      return 'fog'
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return 'drizzle'
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82:
      return 'rain'
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return 'snow'
    case 95:
    case 96:
    case 99:
      return 'thunder'
    default:
      return 'cloud'
  }
}

// 各アイコンの中身（<svg> の子要素）。線幅・線端の丸めは <svg> 側でまとめて指定する。
// dot（雪の粒など）は strokeLinecap='round' の 0 長の線として表現するので、必ず round を効かせる。
const ICONS: Record<WeatherIconName, ReactElement> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  partly: (
    <>
      <path d="M12 2v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="M20 12h2" />
      <path d="m19.07 4.93-1.41 1.41" />
      <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
      <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  fog: (
    <>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 17H7" />
      <path d="M17 21H9" />
    </>
  ),
  drizzle: (
    <>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M8 19v1" />
      <path d="M8 14v1" />
      <path d="M16 19v1" />
      <path d="M16 14v1" />
      <path d="M12 21v1" />
      <path d="M12 16v1" />
    </>
  ),
  rain: (
    <>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v6" />
      <path d="M8 14v6" />
      <path d="M12 16v6" />
    </>
  ),
  snow: (
    <>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M8 15h.01" />
      <path d="M8 19h.01" />
      <path d="M12 17h.01" />
      <path d="M12 21h.01" />
      <path d="M16 15h.01" />
      <path d="M16 19h.01" />
    </>
  ),
  thunder: (
    <>
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
      <path d="m13 12-3 5h4l-3 5" />
    </>
  ),
}

// 天気アイコン。code からアイコンを選び、size(px)で描く。label があれば読み上げ用の
// 画像（role="img"）として名前を持たせ、無ければ装飾（aria-hidden）として扱う。
// 色は currentColor なので、親要素の color を変えれば追従する。
export function WeatherIcon({
  code,
  size = 24,
  label,
  className,
}: {
  code: number
  size?: number
  label?: string
  className?: string
}) {
  const name = weatherIconName(code)
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ICONS[name]}
    </svg>
  )
}
