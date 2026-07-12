// Open-Meteo（APIキー不要・無料・CORS 対応）から天気を取得する。
// Google API とは別サービスなので認証は不要。共通の fetchJson（Google トークンを付ける）は
// 使わず、素の fetch で叩く。
//
// 地点は設定モーダルから変更できる（端末ローカル保存。既定は東京）。地点の型・既定値・ストアは
// location.ts にまとめ、ここでは fetchWeather が地点を引数で受け取る。
import type { WeatherLocation } from './location'

// Open-Meteo のレスポンス（必要な部分だけ型付け）。
interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number
    weather_code?: number
  }
  daily?: {
    time?: string[]
    weather_code?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
  }
}

// 1日ぶんの予報（今日/明日/明後日…）。
export interface DailyForecast {
  date: string // 'YYYY-MM-DD'
  code: number // WMO 天気コード
  tempMax: number
  tempMin: number
}

// 画面に渡す整形済みの天気データ。
export interface Weather {
  locationName: string
  currentTemp: number // 現在の気温（℃）
  currentCode: number // 現在の WMO 天気コード
  daily: DailyForecast[] // 今日から数日ぶん
}

// 天気絵文字をカラー表示に統一する。🌤🌫🌦🌧🌨⛈ などは既定が「文字表示」のため、
// 異体字セレクタ(U+FE0F)を付けないと Windows 等でモノクロの字形になり、☀️⛅☁️ のカラー絵文字と
// 混在して見た目が不揃いになる。すべてに U+FE0F を付けてカラー(絵文字)表示へ強制する。
function colorEmoji(e: string): string {
  return e.endsWith('️') ? e : e + '️'
}

// WMO 天気コード → 絵文字と日本語ラベル。Open-Meteo は天気を数値コードで返すため対応表で変換する。
// https://open-meteo.com/en/docs の Weather variable documentation より。
export function weatherCodeInfo(code: number): { emoji: string; label: string } {
  const info = rawWeatherCodeInfo(code)
  return { emoji: colorEmoji(info.emoji), label: info.label }
}

function rawWeatherCodeInfo(code: number): { emoji: string; label: string } {
  switch (code) {
    case 0:
      return { emoji: '☀️', label: '快晴' }
    case 1:
      return { emoji: '🌤', label: '晴れ' }
    case 2:
      return { emoji: '⛅', label: '一部くもり' }
    case 3:
      return { emoji: '☁️', label: 'くもり' }
    case 45:
    case 48:
      return { emoji: '🌫', label: '霧' }
    case 51:
    case 53:
    case 55:
      return { emoji: '🌦', label: '霧雨' }
    case 56:
    case 57:
      return { emoji: '🌧', label: '着氷性の霧雨' }
    case 61:
    case 63:
    case 65:
      return { emoji: '🌧', label: '雨' }
    case 66:
    case 67:
      return { emoji: '🌧', label: '着氷性の雨' }
    case 71:
    case 73:
    case 75:
      return { emoji: '🌨', label: '雪' }
    case 77:
      return { emoji: '🌨', label: '霧雪' }
    case 80:
    case 81:
    case 82:
      return { emoji: '🌦', label: 'にわか雨' }
    case 85:
    case 86:
      return { emoji: '🌨', label: 'にわか雪' }
    case 95:
      return { emoji: '⛈', label: '雷雨' }
    case 96:
    case 99:
      return { emoji: '⛈', label: '雹をともなう雷雨' }
    default:
      return { emoji: '❓', label: '不明' }
  }
}

// 天気を取得して整形して返す。timezone=auto で地点の時刻に合わせた「今日」を返させる。
export async function fetchWeather(loc: WeatherLocation): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '3', // 今日＋明日・明後日
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
  if (!res.ok) throw new Error(`天気の取得に失敗しました (HTTP ${res.status})`)
  const json = (await res.json()) as OpenMeteoResponse

  const times = json.daily?.time ?? []
  const codes = json.daily?.weather_code ?? []
  const maxs = json.daily?.temperature_2m_max ?? []
  const mins = json.daily?.temperature_2m_min ?? []
  const daily: DailyForecast[] = times.map((date, i) => ({
    date,
    code: codes[i] ?? 0,
    tempMax: maxs[i] ?? 0,
    tempMin: mins[i] ?? 0,
  }))

  return {
    locationName: loc.name,
    currentTemp: json.current?.temperature_2m ?? daily[0]?.tempMax ?? 0,
    currentCode: json.current?.weather_code ?? daily[0]?.code ?? 0,
    daily,
  }
}

// ジオコーディング（地名 → 緯度経度）。Open-Meteo の Geocoding API（APIキー不要）で
// 地名を検索し、候補を返す。設定モーダルで地点を選ぶのに使う。
export interface GeocodeResult {
  name: string // 都市名（例: 東京）
  latitude: number
  longitude: number
  admin1?: string // 都道府県・州など（例: 東京都）
  country?: string // 国（例: 日本）
}

export async function geocodeLocation(query: string): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({
    name: q,
    count: '5',
    language: 'ja',
    format: 'json',
  })
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`)
  if (!res.ok) throw new Error(`地名の検索に失敗しました (HTTP ${res.status})`)
  const json = (await res.json()) as {
    results?: {
      name: string
      latitude: number
      longitude: number
      admin1?: string
      country?: string
    }[]
  }
  return (json.results ?? []).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    admin1: r.admin1,
    country: r.country,
  }))
}
