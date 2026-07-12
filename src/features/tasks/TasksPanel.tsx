// タスクパネル（フェーズ4-a: 読み取り + 完了 + クイック追加）。
// 全リストの未完了タスクを「⚠期限切れ/今日/今後/期限なし」の4グループで表示する。
// - 完了: チェックで即完了。誤タップ対策に画面下部へ「元に戻す」を5秒表示（Undo=reopen）。
// - クイック追加: デフォルトリストにタイトルを追加。期限は「なし」既定＋「今日」ワンタップ。
// 明日へ/来週へ・編集・削除、カレンダー書き込みは後続フェーズ。

import { useEffect, useRef, useState } from 'react'
import { useTasks } from './useTasks'
import { useAddTask, useCompleteTask, useReopenTask } from './useTaskMutations'
import { localTodayStr } from './api'
import type { TaskGroup, TaskItem } from './api'

// グループの表示順とラベル・装飾。
const GROUP_ORDER: { key: TaskGroup; label: string; variant: string }[] = [
  { key: 'overdue', label: '⚠ 期限切れ', variant: 'overdue' },
  { key: 'today', label: '今日', variant: 'today' },
  { key: 'upcoming', label: '今後', variant: 'upcoming' },
  { key: 'noDue', label: '期限なし', variant: 'noDue' },
]

// 期限文字列を「M/D」の短い表示にする（今日/期限なしグループでは表示しない）。
function formatDue(dueStr: string | null): string {
  if (!dueStr) return ''
  const [, m, d] = dueStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

function groupTasks(tasks: TaskItem[]): Record<TaskGroup, TaskItem[]> {
  const groups: Record<TaskGroup, TaskItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    noDue: [],
  }
  for (const t of tasks) groups[t.group].push(t)
  // 期限のあるグループは期限の早い順に並べる
  groups.overdue.sort((a, b) => (a.dueStr ?? '').localeCompare(b.dueStr ?? ''))
  groups.upcoming.sort((a, b) => (a.dueStr ?? '').localeCompare(b.dueStr ?? ''))
  return groups
}

export function TasksPanel() {
  const { data: tasks, isLoading, isError, error } = useTasks()
  const complete = useCompleteTask()
  const reopen = useReopenTask()
  const add = useAddTask()

  // Undo スナックバー。直近1件のみ保持（キューは持たない＝Fable 助言）。
  // Query キャッシュとは別のローカル state に持つことでポーリング更新の影響を受けない。
  const [undoTask, setUndoTask] = useState<TaskItem | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)

  // クイック追加フォームの入力。
  const [newTitle, setNewTitle] = useState('')
  const [dueToday, setDueToday] = useState(false)

  // アンマウント時にタイマーを片付ける
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  function handleComplete(task: TaskItem) {
    complete.mutate({ listId: task.listId, taskId: task.id })
    // スナックバーは直近1件だけ。前のタイマーを消して差し替える。
    window.clearTimeout(undoTimer.current)
    setUndoTask(task)
    undoTimer.current = window.setTimeout(() => setUndoTask(null), 5000)
  }

  function handleUndo() {
    if (undoTask) reopen.mutate(undoTask)
    window.clearTimeout(undoTimer.current)
    setUndoTask(null)
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    add.mutate({ title, dueDateStr: dueToday ? localTodayStr() : null })
    setNewTitle('')
    setDueToday(false)
  }

  return (
    <div className="tasks">
      {/* クイック追加フォーム（常に表示） */}
      <form className="tasks__add" onSubmit={handleAdd}>
        <input
          className="tasks__add-input"
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="タスクを追加…"
          aria-label="新しいタスクのタイトル"
        />
        <button
          type="button"
          className={`btn btn--small tasks__add-today${dueToday ? ' is-on' : ''}`}
          onClick={() => setDueToday((v) => !v)}
          aria-pressed={dueToday}
          title="期限を今日にする"
        >
          今日
        </button>
        <button type="submit" className="btn btn--small btn--primary" disabled={!newTitle.trim()}>
          追加
        </button>
      </form>

      <TaskList
        tasks={tasks}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onComplete={handleComplete}
      />

      {/* Undo スナックバー（画面下部固定・5秒） */}
      {undoTask && (
        <div className="snackbar" role="status">
          <span className="snackbar__text">「{undoTask.title}」を完了にしました</span>
          <button className="snackbar__action" onClick={handleUndo}>
            元に戻す
          </button>
        </div>
      )}
    </div>
  )
}

// タスク一覧の本体（読み込み中/エラー/空/グループ表示）。
function TaskList({
  tasks,
  isLoading,
  isError,
  error,
  onComplete,
}: {
  tasks: TaskItem[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  onComplete: (task: TaskItem) => void
}) {
  if (isLoading) {
    return <p className="panel__note">タスクを読み込み中…</p>
  }
  if (isError) {
    return <p className="panel__note panel__note--error">タスクの取得に失敗しました: {String(error)}</p>
  }
  if (!tasks || tasks.length === 0) {
    return <p className="panel__note">タスクはありません。すべて順調</p>
  }

  const groups = groupTasks(tasks)

  return (
    <>
      {GROUP_ORDER.map(({ key, label, variant }) => {
        const items = groups[key]
        if (items.length === 0) return null
        return (
          <section key={key} className="tasks__group">
            <h3 className={`tasks__group-header tasks__group-header--${variant}`}>
              {label} <span className="tasks__count">{items.length}</span>
            </h3>
            <ul className="tasks__list">
              {items.map((t) => (
                <li key={`${t.listId}:${t.id}`} className="tasks__item">
                  <button
                    className="tasks__check"
                    onClick={() => onComplete(t)}
                    disabled={t.pending}
                    aria-label={`「${t.title}」を完了にする`}
                    title="完了にする"
                  >
                    <span className="tasks__check-box" aria-hidden="true" />
                  </button>
                  {/* 期限セルは常に描画して列の位置を揃える（期限なし/今日は空欄） */}
                  <span className="tasks__due">
                    {(key === 'overdue' || key === 'upcoming') && t.dueStr ? formatDue(t.dueStr) : ''}
                  </span>
                  <span className="tasks__title">{t.title}</span>
                  <span className="tasks__list-name">{t.listName}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}
