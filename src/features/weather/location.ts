// 天気の表示地点（端末ローカル設定）。displayPrefs と同じ購読可能ストア方式で、
// 設定モーダルで変更すると天気パネルが即座に新しい地点で取得し直す。
//
// 地点は「表示名＋緯度・経度」を持つオブジェクト。localStorage には JSON 文字列で保存する。
// useSyncExternalStore に渡すスナップショットは、値が変わらない限り同じオブジェクト参照を
// 返す必要がある（毎回 JSON.parse すると参照が変わり無限再描画になるため、パース結果を保持する）。

import { useSyncExternalStore } from 'react'

export interface WeatherLocation {
  name: string
  latitude: number
  longitude: number
}

// 既定は東京（グリルで v1 は地名固定と決めた既定地点）。
export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  name: '東京',
  latitude: 35.6785,
  longitude: 139.6823,
}

const KEY = 'abops:weatherLocation'

function read(): WeatherLocation {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_WEATHER_LOCATION
    const parsed = JSON.parse(raw) as Partial<WeatherLocation>
    // 壊れた値・型違いは既定にフォールバック
    if (
      typeof parsed?.name === 'string' &&
      typeof parsed?.latitude === 'number' &&
      typeof parsed?.longitude === 'number'
    ) {
      return { name: parsed.name, latitude: parsed.latitude, longitude: parsed.longitude }
    }
    return DEFAULT_WEATHER_LOCATION
  } catch {
    return DEFAULT_WEATHER_LOCATION
  }
}

let location: WeatherLocation = read()
const listeners = new Set<() => void>()

export function getWeatherLocation(): WeatherLocation {
  return location
}

export function setWeatherLocation(value: WeatherLocation): void {
  location = value
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // localStorage が使えなくてもメモリ上の値で動作継続
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWeatherLocation(): WeatherLocation {
  return useSyncExternalStore(subscribe, getWeatherLocation)
}
