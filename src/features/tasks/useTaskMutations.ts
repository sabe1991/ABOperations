// タスクの書き込み（完了・Undo再オープン・クイック追加）の TanStack Query mutation。
//
// 設計方針（Fable 助言）:
// - すべて楽観的更新: onMutate でキャッシュを即書き換え → onError で巻き戻し → onSettled で invalidate（再取得予約）。
//   「即時反映=optimistic、最終整合=invalidate」の役割分担。
// - onMutate では必ず cancelQueries でポーリング中の取得を中断し、楽観結果が上書きされないようにする。
// - Undo は「送信のキャンセル」ではなく「reopen という逆操作の実行」。完了は即サーバー確定する。

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { classify, completeTask, insertTask, localTodayStr, reopenTask } from './api'
import type { TaskItem } from './api'

// タスク一覧クエリのキー（useTasks と一致させる）。
const TASKS_KEY = ['tasks', 'all'] as const

// 楽観的更新の共通ヘルパ。キャッシュを差し替え、巻き戻し用に旧スナップショットを返す。
function optimisticUpdate(
  qc: ReturnType<typeof useQueryClient>,
  update: (old: TaskItem[]) => TaskItem[],
) {
  const prev = qc.getQueryData<TaskItem[]>(TASKS_KEY)
  qc.setQueryData<TaskItem[]>(TASKS_KEY, (old) => update(old ?? []))
  return prev
}

// タスクを完了にする（一覧から即座に消す）。
export function useCompleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, taskId }: { listId: string; taskId: string }) =>
      completeTask(listId, taskId),
    onMutate: async ({ listId, taskId }) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const prev = optimisticUpdate(qc, (old) =>
        old.filter((t) => !(t.listId === listId && t.id === taskId)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}

// 完了を取り消して未完了に戻す（Undo）。消したタスクを即座に一覧へ戻す。
export function useReopenTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (task: TaskItem) => reopenTask(task.listId, task.id),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const prev = optimisticUpdate(qc, (old) => [task, ...old])
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}

// タスクをデフォルトリストに追加する。仮IDで先頭に即表示し、確定後 invalidate で本物に置き換える。
export function useAddTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; dueDateStr: string | null }) =>
      insertTask({ title: input.title, dueDateStr: input.dueDateStr }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const dueStr = input.dueDateStr ?? null
      const optimistic: TaskItem = {
        id: `temp-${Date.now()}`,
        title: input.title,
        listId: '@default',
        listName: '',
        dueStr,
        group: classify(dueStr, localTodayStr()),
        pending: true, // サーバーIDが無い間は完了操作を不可に
      }
      const prev = optimisticUpdate(qc, (old) => [optimistic, ...old])
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}
