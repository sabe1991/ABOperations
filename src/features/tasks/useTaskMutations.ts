// タスクの書き込み（完了・Undo再オープン・追加/復元・編集/期限変更・削除）の TanStack Query mutation。
//
// 設計方針（Fable 助言）:
// - すべて楽観的更新: onMutate でキャッシュを即書き換え → onError で巻き戻し → onSettled で invalidate（再取得予約）。
//   「即時反映=optimistic、最終整合=invalidate」の役割分担。
// - onMutate では必ず cancelQueries でポーリング中の取得を中断し、楽観結果が上書きされないようにする。
// - 破壊的操作(完了・削除)の Undo は「送信のキャンセル」ではなく「逆操作の実行」（reopen / 再insert）。
//   即サーバー確定するので、リロードやアプリ再起動でも操作が飛ばない。

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  classify,
  completeTask,
  deleteTask,
  insertTask,
  localTodayStr,
  reopenTask,
  updateTask,
} from './api'
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

// タスクを追加する（クイック追加＝デフォルトリスト、および削除Undoの復元＝元のリスト）。
// 仮IDで先頭に即表示し、確定後 invalidate で本物に置き換える。
export function useInsertTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      title: string
      dueDateStr: string | null
      listId?: string
      listName?: string
    }) =>
      insertTask({
        title: input.title,
        dueDateStr: input.dueDateStr,
        listId: input.listId,
        listName: input.listName,
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const dueStr = input.dueDateStr ?? null
      const optimistic: TaskItem = {
        id: `temp-${Date.now()}`,
        title: input.title,
        listId: input.listId ?? '@default',
        listName: input.listName ?? '',
        dueStr,
        group: classify(dueStr, localTodayStr()),
        pending: true, // サーバーIDが無い間は完了・編集・削除を不可に
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

// タスクのタイトル・期限を更新する（編集、および「明日へ/来週へ」の期限変更に共用）。
// dueDateStr: 文字列=その日付, null=期限クリア, undefined=変更しない。
export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      task,
      patch,
    }: {
      task: TaskItem
      patch: { title?: string; dueDateStr?: string | null }
    }) => updateTask(task.listId, task.id, patch),
    onMutate: async ({ task, patch }) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const prev = optimisticUpdate(qc, (old) =>
        old.map((t) => {
          if (t.listId !== task.listId || t.id !== task.id) return t
          const dueStr = patch.dueDateStr !== undefined ? patch.dueDateStr : t.dueStr
          const title = patch.title !== undefined ? patch.title : t.title
          // 期限が変われば所属グループも変わる。dueから即再計算して行を移動させる。
          return { ...t, title, dueStr, group: classify(dueStr, localTodayStr()) }
        }),
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

// タスクを削除する（一覧から即除去）。Undo は同じ内容の再insert（useInsertTask 側）で行う。
export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (task: TaskItem) => deleteTask(task.listId, task.id),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const prev = optimisticUpdate(qc, (old) =>
        old.filter((t) => !(t.listId === task.listId && t.id === task.id)),
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
