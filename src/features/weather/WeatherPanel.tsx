// 天気（密度型レイアウトの3列目・上段）。
// Open-Meteo（APIキー不要・無料）で、東京の現在の天気・気温と数日ぶんの予報を小さく表示する。
// 3列目上段の小さな枠に収めるため、現在＋今日の最高/最低＋数日のミニ予報だけをコンパクトに置く。
import { useWeather } from './useWeather'
import { weatherCodeInfo } from './api'
import type { DailyForecast } from './api'

// 予報の日付ラベル（今日/明日/明後日、それ以降は M/D）。
function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return '今日'
  if (index === 1) return '明日'
  if (index === 2) return '明後日'
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

export function WeatherPanel() {
  const { data, isLoading, isError } = useWeather()

  if (isError) return <p className="panel__note panel__note--error">天気の取得に失敗しました。</p>
  if (isLoading && !data) return <p className="panel__note">読み込み中…</p>
  if (!data) return null

  const cur = weatherCodeInfo(data.currentCode)
  const today: DailyForecast | undefined = data.daily[0]

  return (
    <div className="weather">
      {/* 現在の天気（大きめの絵文字＋気温）。右に地点名と今日の最高/最低。 */}
      <div className="weather__now">
        <span className="weather__now-emoji" aria-hidden="true">
          {cur.emoji}
        </span>
        <span className="weather__now-temp">{Math.round(data.currentTemp)}°</span>
        <span className="weather__now-meta">
          <span className="weather__loc">{data.locationName}</span>
          <span className="weather__cond">{cur.label}</span>
          {today && (
            <span className="weather__hilo">
              <span className="weather__hi">{Math.round(today.tempMax)}°</span>
              <span className="weather__sep"> / </span>
              <span className="weather__lo">{Math.round(today.tempMin)}°</span>
            </span>
          )}
        </span>
      </div>

      {/* 明日・明後日のミニ予報（今日は左の現在表示に含まれるので省く）。絵文字と最高/最低だけ。 */}
      <div className="weather__days">
        {data.daily.map((d, i) => {
          if (i === 0) return null
          const info = weatherCodeInfo(d.code)
          return (
            <div key={d.date} className="weather__day" title={info.label}>
              <span className="weather__day-label">{dayLabel(d.date, i)}</span>
              <span className="weather__day-emoji" aria-hidden="true">
                {info.emoji}
              </span>
              <span className="weather__day-temp">
                <span className="weather__hi">{Math.round(d.tempMax)}°</span>
                <span className="weather__lo">{Math.round(d.tempMin)}°</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
