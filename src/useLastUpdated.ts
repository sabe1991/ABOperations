// 「データの最終更新時刻」をヘッダーに出すためのフック。
// アプリの各パネル（予定・タスク・メール・天気・ニュース等）は TanStack Query で取得しており、
// 各クエリは最後に成功した取得時刻 `dataUpdatedAt` を保持している。ここではキャッシュ全体を購読し、
// 成功済みクエリの中で最も新しい取得時刻（＝一番最近データが更新された時刻）を返す。
// R キーやポーリング・画面復帰での再取得で値が進むと、ヘッダー表示も自動で更新される。
import { useSyncExternalStore } from 'react'
import { queryClient } from './queryClient'

function getSnapshot(): number {
  let max = 0
  for (const q of queryClient.getQueryCache().getAll()) {
    // 成功して実データを持つクエリのみを対象にする（エラー・未取得は無視）。
    if (q.state.status === 'success' && q.state.dataUpdatedAt > max) {
      max = q.state.dataUpdatedAt
    }
  }
  return max // ミリ秒。数値なので参照は毎回同じ値なら安定（useSyncExternalStore の再描画抑制が効く）。
}

function subscribe(onChange: () => void): () => void {
  return queryClient.getQueryCache().subscribe(onChange)
}

// 最終更新時刻（epoch ミリ秒）。まだ何も取得できていなければ 0。
export function useLastUpdated(): number {
  return useSyncExternalStore(subscribe, getSnapshot)
}
