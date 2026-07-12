// タスクを取得する TanStack Query フック。カレンダーと同じ方針
// （接続済みかつ再接続不要なときだけ動く、5分ポーリング、401は共通ハンドラで処理）。

import { useIsMutating, useQuery } from '@tanstack/react-query'
import { fetchAllTasks } from './api'
import { useAuth } from '../../auth/useAuth'

export function useTasks() {
  const { isConnected, needsReconnect, needsScope } = useAuth()
  // 書き込み(完了/追加/Undo)実行中はポーリングを止め、楽観的更新の一瞬を
  // ポーリング結果が上書きしないようにする（Fable 助言）。
  const mutating = useIsMutating() > 0
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: fetchAllTasks,
    // 権限不足(needsScope)のときは 403 を叩き続けないよう取得を止める。追加同意後に復活する。
    enabled: isConnected && !needsReconnect && !needsScope,
    refetchInterval: mutating ? false : 5 * 60 * 1000,
  })
}
