// タスクを取得する TanStack Query フック。カレンダーと同じ方針
// （接続済みかつ再接続不要なときだけ動く、5分ポーリング、401は共通ハンドラで処理）。

import { useQuery } from '@tanstack/react-query'
import { fetchAllTasks } from './api'
import { useAuth } from '../../auth/useAuth'

export function useTasks() {
  const { isConnected, needsReconnect } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: fetchAllTasks,
    enabled: isConnected && !needsReconnect,
    refetchInterval: 5 * 60 * 1000,
  })
}
