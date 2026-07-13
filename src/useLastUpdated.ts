// 「データの最終更新時刻」をヘッダーに出すためのフック。
// アプリの各パネル（予定・タスク・メール・天気・ニュース等）は TanStack Query で取得しており、
// 各クエリは最後に成功した取得時刻 `dataUpdatedAt` を保持している。ここではキャッシュ全体を購読し、
// 成功済みクエリの中で最も新しい取得時刻（＝一番最近データが更新された時刻）を返す。
// R キーやポーリング・画面復帰での再取得で値が進むと、ヘッダー表示も自動で更新される。
import { useSyncExternalStore } from 'react'
import type { QueryCacheNotifyEvent } from '@tanstack/react-query'
import { queryClient } from './queryClient'

// 最終更新時刻のキャッシュ値と「再計算が必要か」のフラグ。
// キャッシュ全体の走査（O(n)）は「実際にデータが更新された/クエリが消えた」ときだけに限定し、
// 取得中・オブザーバ増減など大量に飛ぶイベントのたびに全走査しないようにする（#66）。
let cached = 0
let dirty = true

function recompute(): number {
  let max = 0
  for (const q of queryClient.getQueryCache().getAll()) {
    // 成功して実データを持つクエリのみを対象にする（エラー・未取得は無視）。
    if (q.state.status === 'success' && q.state.dataUpdatedAt > max) {
      max = q.state.dataUpdatedAt
    }
  }
  return max
}

function getSnapshot(): number {
  // dirty のときだけ再計算する。それ以外は前回値をそのまま返すので参照が安定し、
  // useSyncExternalStore の再描画抑制が効く（値はミリ秒の数値）。
  if (dirty) {
    cached = recompute()
    dirty = false
  }
  return cached
}

// 最終更新時刻に影響するイベントか。データ更新の成功、またはクエリ削除のときだけ再計算対象にする。
function affectsLastUpdated(event: QueryCacheNotifyEvent): boolean {
  if (event.type === 'removed') return true
  return event.type === 'updated' && event.action.type === 'success'
}

function subscribe(onChange: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (affectsLastUpdated(event)) {
      dirty = true
      onChange()
    }
  })
}

// 最終更新時刻（epoch ミリ秒）。まだ何も取得できていなければ 0。
export function useLastUpdated(): number {
  return useSyncExternalStore(subscribe, getSnapshot)
}
