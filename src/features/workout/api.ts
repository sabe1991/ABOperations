// 姉妹ツール AB Workout の「今週のメニュー」を取得する（認証不要・CORS 対応・JSON 直取り）。
// 天気(Open-Meteo)やニュースと同じ発想で、鍵の要らない公開URLをブラウザから直接読む。
// データ元は AB Workout(Android) → 非公開リポジトリ abworkout-backups の latest.json を、
// GitHub Action が週プランだけ抜き出して Secret Gist(非公開URLのメモ)へ書き出したもの。
// Gist の raw は access-control-allow-origin: * を返すためブラウザから直接取得できる。
import { fetchWithTimeout, asObject } from '../../fetchTimeout'
import type { WeekPlan } from './nextWorkout'

// week.json の生URL（Secret Gist の raw。コミットSHAを含めない形なので常に最新版を返す＝
// GitHub 側の CDN キャッシュで数分遅れる程度）。Gist を作り直したらこのIDを差し替える。
export const WEEK_PLAN_URL =
  'https://gist.githubusercontent.com/sabe1991/986828ca45a030de0beba770941d7d25/raw/week.json'

export async function fetchWeekPlan(): Promise<WeekPlan> {
  const res = await fetchWithTimeout(WEEK_PLAN_URL)
  if (!res.ok) {
    throw new Error(`今週のメニューの取得に失敗しました (HTTP ${res.status})`)
  }
  const plan = asObject<WeekPlan>(await res.json(), '今週のメニュー')
  // 最低限の形チェック（sessions が配列でないと表示側の .map が落ちるため）。
  if (!Array.isArray(plan.sessions)) {
    throw new Error('今週のメニューの応答が想定した形式ではありませんでした')
  }
  return plan
}
