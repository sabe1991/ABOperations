// タスクパネル（フェーズ4-a/4-b: 読み取り + 完了 + クイック追加 + 明日へ/来週へ・編集・削除）。
// 全リストの未完了タスクを「⚠期限切れ/今日/今後/期限なし」の4グループで表示する。
// - 完了: 左の丸チェックで即完了。誤タップ対策に画面下部へ「元に戻す」を5秒表示（Undo=reopen）。
// - 行タップ: 下にアクションバー（明日へ/来週へ/編集/削除）を展開（開くのは常に1行だけ）。
// - 明日へ/来週へ: 期限を今日基準で変更。移動もスナックバーで Undo できる。
// - 編集: ボトムシート（下から出る小モーダル）でタイトルと期限を変更。
// - 削除: 即削除し「元に戻す」を表示（Undo=同じ内容で再作成。Tasks に復元APIが無いため）。
// グループ分けは保存値ではなく毎回 due から導出する（期限変更時に行が即移動する）。

import { useEffect, useRef, useState } from 'react'
import { useTasks } from './useTasks'
import {
  useCompleteTask,
  useDeleteTask,
  useInsertTask,
  useReopenTask,
  useUpdateTask,
} from './useTaskMutations'
import { classify, localDateStrPlusDays, localNextMondayStr, localTodayStr } from './api'
import type { TaskGroup, TaskItem } from './api'
import { useAuth } from '../../auth/useAuth'

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

// グループ分けは保存値ではなく due から毎回導出する（Fable 助言）。文字列比較で TZ ズレも回避。
function groupTasks(tasks: TaskItem[]): Record<TaskGroup, TaskItem[]> {
  const today = localTodayStr()
  const groups: Record<TaskGroup, TaskItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    noDue: [],
  }
  for (const t of tasks) groups[classify(t.dueStr, today)].push(t)
  // 期限のあるグループは期限の早い順に並べる
  groups.overdue.sort((a, b) => (a.dueStr ?? '').localeCompare(b.dueStr ?? ''))
  groups.upcoming.sort((a, b) => (a.dueStr ?? '').localeCompare(b.dueStr ?? ''))
  return groups
}

type Snack = { text: string; undo: () => void }

export function TasksPanel() {
  const { needsScope } = useAuth()
  const { data: tasks, isLoading, isError, error } = useTasks()
  const complete = useCompleteTask()
  const reopen = useReopenTask()
  const insert = useInsertTask()
  const update = useUpdateTask()
  const del = useDeleteTask()

  // スナックバー（完了/移動/削除の Undo）。直近1件のみ・Query キャッシュ外のローカル state。
  const [snack, setSnack] = useState<Snack | null>(null)
  const snackTimer = useRef<number | undefined>(undefined)

  // アクションバーを開いている行のキー（常に1行のみ）。
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // 編集ボトムシートで開いているタスク。
  const [editing, setEditing] = useState<TaskItem | null>(null)

  // クイック追加フォームの入力。
  const [newTitle, setNewTitle] = useState('')
  const [dueToday, setDueToday] = useState(false)

  // アンマウント時にタイマーを片付ける
  useEffect(() => () => window.clearTimeout(snackTimer.current), [])

  function showSnack(text: string, undo: () => void) {
    window.clearTimeout(snackTimer.current)
    setSnack({ text, undo })
    snackTimer.current = window.setTimeout(() => setSnack(null), 5000)
  }
  function handleSnackUndo() {
    if (snack) snack.undo()
    window.clearTimeout(snackTimer.current)
    setSnack(null)
  }

  function handleComplete(task: TaskItem) {
    complete.mutate({ listId: task.listId, taskId: task.id })
    showSnack(`「${task.title}」を完了にしました`, () => reopen.mutate(task))
  }

  function handleReschedule(task: TaskItem, dueDateStr: string, label: string) {
    const oldDue = task.dueStr
    update.mutate({ task, patch: { dueDateStr } })
    showSnack(`${label}に移動しました`, () => update.mutate({ task, patch: { dueDateStr: oldDue } }))
    setExpandedKey(null)
  }

  function handleDelete(task: TaskItem) {
    del.mutate(task)
    showSnack(`「${task.title}」を削除しました`, () =>
      insert.mutate({
        title: task.title,
        dueDateStr: task.dueStr,
        listId: task.listId,
        listName: task.listName,
      }),
    )
    setExpandedKey(null)
  }

  function handleSaveEdit(task: TaskItem, patch: { title: string; dueDateStr: string | null }) {
    update.mutate({ task, patch })
    setEditing(null)
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    insert.mutate({ title, dueDateStr: dueToday ? localTodayStr() : null })
    setNewTitle('')
    setDueToday(false)
  }

  // 権限不足のときは操作UIを出さず、追加同意を促すメッセージだけ表示する
  // （追加・完了も Tasks 権限が要るため）。同意は画面上部の「許可する」バナーから。
  if (needsScope) {
    return (
      <p className="panel__note">
        タスクを表示・操作するには追加の許可が必要です。画面上部の「許可する」を押してください。
      </p>
    )
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
        expandedKey={expandedKey}
        onToggleExpand={(key) => setExpandedKey((cur) => (cur === key ? null : key))}
        onComplete={handleComplete}
        onReschedule={handleReschedule}
        onEdit={(t) => {
          setEditing(t)
          setExpandedKey(null)
        }}
        onDelete={handleDelete}
      />

      {/* 編集ボトムシート */}
      {editing && (
        <EditSheet task={editing} onClose={() => setEditing(null)} onSave={handleSaveEdit} />
      )}

      {/* Undo スナックバー（画面下部固定・5秒） */}
      {snack && (
        <div className="snackbar" role="status">
          <span className="snackbar__text">{snack.text}</span>
          <button className="snackbar__action" onClick={handleSnackUndo}>
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
  expandedKey,
  onToggleExpand,
  onComplete,
  onReschedule,
  onEdit,
  onDelete,
}: {
  tasks: TaskItem[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  expandedKey: string | null
  onToggleExpand: (key: string) => void
  onComplete: (task: TaskItem) => void
  onReschedule: (task: TaskItem, dueDateStr: string, label: string) => void
  onEdit: (task: TaskItem) => void
  onDelete: (task: TaskItem) => void
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
              {items.map((t) => {
                const rowKey = `${t.listId}:${t.id}`
                const showDue = (key === 'overdue' || key === 'upcoming') && t.dueStr
                return (
                  <li key={rowKey} className="tasks__item-wrap">
                    <div className="tasks__item">
                      <button
                        className="tasks__check"
                        onClick={() => onComplete(t)}
                        disabled={t.pending}
                        aria-label={`「${t.title}」を完了にする`}
                        title="完了にする"
                      >
                        <span className="tasks__check-box" aria-hidden="true" />
                      </button>
                      {/* 行本体タップでアクションバーを開閉。追加直後(pending)は操作不可 */}
                      <button
                        className="tasks__row"
                        onClick={() => !t.pending && onToggleExpand(rowKey)}
                        disabled={t.pending}
                        aria-expanded={expandedKey === rowKey}
                      >
                        {/* 期限セルは常に描画して列の位置を揃える（期限なし/今日は空欄） */}
                        <span className="tasks__due">{showDue ? formatDue(t.dueStr) : ''}</span>
                        <span className="tasks__title">{t.title}</span>
                        <span className="tasks__list-name">{t.listName}</span>
                      </button>
                    </div>

                    {expandedKey === rowKey && (
                      <div className="tasks__actions">
                        <button
                          className="tasks__action"
                          onClick={() => onReschedule(t, localDateStrPlusDays(1), '明日へ')}
                        >
                          明日へ
                        </button>
                        <button
                          className="tasks__action"
                          onClick={() => onReschedule(t, localNextMondayStr(), '来週へ')}
                        >
                          来週へ
                        </button>
                        <button className="tasks__action" onClick={() => onEdit(t)}>
                          編集
                        </button>
                        <button
                          className="tasks__action tasks__action--danger"
                          onClick={() => onDelete(t)}
                        >
                          削除
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </>
  )
}

// 編集ボトムシート。タイトルと期限（なし/今日/明日/日付指定）を変更して保存する。
function EditSheet({
  task,
  onClose,
  onSave,
}: {
  task: TaskItem
  onClose: () => void
  onSave: (task: TaskItem, patch: { title: string; dueDateStr: string | null }) => void
}) {
  const today = localTodayStr()
  const tomorrow = localDateStrPlusDays(1)

  type DueMode = 'none' | 'today' | 'tomorrow' | 'custom'
  const initialMode: DueMode = !task.dueStr
    ? 'none'
    : task.dueStr === today
      ? 'today'
      : task.dueStr === tomorrow
        ? 'tomorrow'
        : 'custom'

  const [title, setTitle] = useState(task.title)
  const [dueMode, setDueMode] = useState<DueMode>(initialMode)
  // 「日付指定」で使う値。初期は既存期限（今日/明日/なしなら今日を初期表示）。
  const [customDate, setCustomDate] = useState(
    initialMode === 'custom' && task.dueStr ? task.dueStr : today,
  )

  function resolveDue(): string | null {
    switch (dueMode) {
      case 'none':
        return null
      case 'today':
        return today
      case 'tomorrow':
        return tomorrow
      case 'custom':
        return customDate || null
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onSave(task, { title: trimmed, dueDateStr: resolveDue() })
  }

  const DUE_CHIPS: { mode: DueMode; label: string }[] = [
    { mode: 'none', label: 'なし' },
    { mode: 'today', label: '今日' },
    { mode: 'tomorrow', label: '明日' },
    { mode: 'custom', label: '日付指定' },
  ]

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-label="タスクを編集"
      >
        <h3 className="sheet__title">タスクを編集</h3>

        <label className="sheet__label" htmlFor="edit-title">
          タイトル
        </label>
        <input
          id="edit-title"
          className="tasks__add-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        <div className="sheet__label">期限</div>
        <div className="sheet__chips">
          {DUE_CHIPS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className={`btn btn--small${dueMode === mode ? ' is-on tasks__add-today' : ''}`}
              onClick={() => setDueMode(mode)}
              aria-pressed={dueMode === mode}
            >
              {label}
            </button>
          ))}
        </div>
        {dueMode === 'custom' && (
          <input
            className="tasks__add-input sheet__date"
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            aria-label="期限の日付"
          />
        )}

        <div className="sheet__buttons">
          <button type="button" className="btn btn--small" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn--small btn--primary" disabled={!title.trim()}>
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
