// 天気（密度型レイアウトの1列目・上段。タイムラインの上）。
// Open-Meteo（APIキー不要・無料）で、現在の天気・気温と数日ぶんの予報を小さく表示する。
// 細い列に収めるため縦2段: 上段=今日（現在＋最高/最低）、下段=明日・明後日のミニ予報。
import { useWeather } from './useWeather'
import { weatherCodeInfo } from './api'
import type { DailyForecast } from './api'
import { WeatherSkeleton } from '../../Skeleton'

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
  if (isLoading && !data) return <WeatherSkeleton />
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
              {/* 最高/最低は色（赤/青）だけで区別しているので、読み上げ用にラベルを付ける（#57）。 */}
              <span className="weather__hi" aria-label={`最高 ${Math.round(today.tempMax)}度`}>
                {Math.round(today.tempMax)}°
              </span>
              <span className="weather__sep" aria-hidden="true">
                {' '}
                /{' '}
              </span>
              <span className="weather__lo" aria-label={`最低 ${Math.round(today.tempMin)}度`}>
                {Math.round(today.tempMin)}°
              </span>
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
              {/* 天気は絵文字だけだと読み上げられないので、日本語ラベルを画像扱いで持たせる（#57）。 */}
              <span className="weather__day-emoji" role="img" aria-label={info.label}>
                {info.emoji}
              </span>
              <span className="weather__day-temp">
                <span className="weather__hi" aria-label={`最高 ${Math.round(d.tempMax)}度`}>
                  {Math.round(d.tempMax)}°
                </span>
                <span className="weather__lo" aria-label={`最低 ${Math.round(d.tempMin)}度`}>
                  {Math.round(d.tempMin)}°
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
