// Open-Meteo（APIキー不要・無料・CORS 対応）から天気を取得する。
// Google API とは別サービスなので認証は不要。共通の fetchJson（Google トークンを付ける）は
// 使わず、素の fetch で叩く。
//
// v1 は地点を東京に固定する（グリル時の決定「地名固定でv1に入れる」）。将来ここを設定値に
// 差し替えられるよう、地点は定数 LOCATION にまとめておく。

// 表示する地点（v1 は東京に固定）。緯度・経度と表示名だけ持つ。
export const LOCATION = {
  name: '東京',
  latitude: 35.6785,
  longitude: 139.6823,
}

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

// WMO 天気コード → 絵文字と日本語ラベル。Open-Meteo は天気を数値コードで返すため対応表で変換する。
// https://open-meteo.com/en/docs の Weather variable documentation より。
export function weatherCodeInfo(code: number): { emoji: string; label: string } {
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
export async function fetchWeather(): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(LOCATION.latitude),
    longitude: String(LOCATION.longitude),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '4', // 今日＋3日ぶん
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
    locationName: LOCATION.name,
    currentTemp: json.current?.temperature_2m ?? daily[0]?.tempMax ?? 0,
    currentCode: json.current?.weather_code ?? daily[0]?.code ?? 0,
    daily,
  }
}
