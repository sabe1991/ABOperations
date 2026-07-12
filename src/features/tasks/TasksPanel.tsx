// タスクパネル（フェーズ4-a/4-b: 読み取り + 完了 + クイック追加 + 明日へ/来週へ・編集・削除）。
// 全リストの未完了タスクを「⚠期限切れ/今日/明日/今週/以降/期限なし」の6バケツで表示する。
// 密度型（≥1200px）ではこのバケツを横並びの多列カラムにし（かんばん風）、狭い幅では縦積みにする。
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
import { localDateStrPlusDays, localNextMondayStr, localTodayStr } from './api'
import type { TaskItem } from './api'
import { useAuth } from '../../auth/useAuth'
import { useShowSourceLabels } from '../settings/displayPrefs'
import { ListSkeleton } from '../../Skeleton'

// 表示用のバケツ（api の TaskGroup とは別に、表示側で due から細かく分ける）。
type Bucket = 'overdue' | 'today' | 'tomorrow' | 'later' | 'noDue'

// バケツの表示順とラベル・装飾。この順でカラム／セクションを並べる。
const GROUP_ORDER: { key: Bucket; label: string; variant: string }[] = [
  { key: 'overdue', label: '⚠ 期限切れ', variant: 'overdue' },
  { key: 'today', label: '今日', variant: 'today' },
  { key: 'tomorrow', label: '明日', variant: 'tomorrow' },
  { key: 'later', label: '以降', variant: 'later' },
  { key: 'noDue', label: '期限なし', variant: 'noDue' },
]

// 期限の「移動先」ボタン。getDate はクリック時に評価して今日基準の日付を返す。
type RescheduleTarget = { label: string; getDate: () => string }
const TO_TODAY: RescheduleTarget = { label: '今日へ', getDate: () => localTodayStr() }
const TO_TOMORROW: RescheduleTarget = { label: '明日へ', getDate: () => localDateStrPlusDays(1) }
const TO_NEXT_WEEK: RescheduleTarget = { label: '来週へ', getDate: () => localNextMondayStr() }

// バケツごとの移動先ボタン。自分と同じ日への無意味な移動は出さない（例: 明日タスクに「明日へ」）。
const RESCHEDULE_BY_BUCKET: Record<Bucket, RescheduleTarget[]> = {
  overdue: [TO_TODAY, TO_TOMORROW],
  today: [TO_TOMORROW, TO_NEXT_WEEK],
  tomorrow: [TO_TODAY, TO_NEXT_WEEK],
  later: [TO_TODAY, TO_TOMORROW],
  noDue: [TO_TODAY, TO_TOMORROW],
}

// 「以降」に含める上限日数（予定パネル・ミニカレンダーの先5週間＝35日に合わせる・ユーザー要望）。
const UPCOMING_DAYS = 35

// 期限文字列を「M/D」の短い表示にする（今日/期限なしグループでは表示しない）。
function formatDue(dueStr: string | null): string {
  if (!dueStr) return ''
  const [, m, d] = dueStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

// バケツ分けは保存値ではなく due から毎回導出する（Fable 助言）。文字列比較で TZ ズレも回避。
// 今日・明日・以降（明後日〜35日）・期限切れ・期限なしに分ける。
function bucketTasks(tasks: TaskItem[]): Record<Bucket, TaskItem[]> {
  const today = localTodayStr()
  const tomorrow = localDateStrPlusDays(1)
  // 「以降」は今日から UPCOMING_DAYS 日先までに絞る（予定パネル・カレンダーの先5週間と揃える）。
  // 期限切れ・期限なしは日数に関係なくすべて表示する（見落とし防止のため）。
  const upcomingLimit = localDateStrPlusDays(UPCOMING_DAYS)

  const groups: Record<Bucket, TaskItem[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    later: [],
    noDue: [],
  }
  for (const t of tasks) {
    const d = t.dueStr
    if (!d) groups.noDue.push(t)
    else if (d < today) groups.overdue.push(t)
    else if (d === today) groups.today.push(t)
    else if (d === tomorrow) groups.tomorrow.push(t)
    else if (d <= upcomingLimit) groups.later.push(t)
    // d > upcomingLimit（35日より先）は表示しない
  }
  // 期限のあるバケツは期限の早い順に並べる（today/tomorrow は同一日なので並べ替え不要）。
  const byDue = (a: TaskItem, b: TaskItem) => (a.dueStr ?? '').localeCompare(b.dueStr ?? '')
  groups.overdue.sort(byDue)
  groups.later.sort(byDue)
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
    // label は「今日へ」等。文末の「へ」を落として「今日に移動しました」と自然にする。
    showSnack(`${label.replace(/へ$/, '')}に移動しました`, () =>
      update.mutate({ task, patch: { dueDateStr: oldDue } }),
    )
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
        <div className="tasks__add-row">
          <label className="tasks__add-check">
            <input
              type="checkbox"
              checked={dueToday}
              onChange={(e) => setDueToday(e.target.checked)}
            />
            期限を今日にする
          </label>
          <button type="submit" className="btn btn--small btn--primary" disabled={!newTitle.trim()}>
            追加
          </button>
        </div>
      </form>

      <div className="tasks__scroll">
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
      </div>

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
  // 出典名（リスト名）を表示するかは端末ローカルの表示設定に従う（既定は非表示）。
  const showLabels = useShowSourceLabels()
  if (isLoading) {
    return <ListSkeleton rows={5} />
  }
  if (isError) {
    return <p className="panel__note panel__note--error">タスクの取得に失敗しました: {String(error)}</p>
  }
  if (!tasks || tasks.length === 0) {
    return <p className="panel__note">タスクはありません。すべて順調</p>
  }

  const groups = bucketTasks(tasks)

  return (
    // 密度型（≥1200px）ではこのラッパを flex 多列にしてバケツを横並びにする（CSS 側で制御）。
    <div className="tasks__groups">
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
                // 日付が自明でないバケツ（期限切れ/以降）でだけ期限を表示する。
                const showDue = (key === 'overdue' || key === 'later') && t.dueStr
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
                        {/* 期限は日付が自明でないバケツ（期限切れ/今週/以降）でだけ表示。
                            今日/明日/期限なしは日付欄ごと描画しない（余白を残さない）。 */}
                        {showDue && <span className="tasks__due">{formatDue(t.dueStr)}</span>}
                        <span className="tasks__title">{t.title}</span>
                        {showLabels && <span className="tasks__list-name">{t.listName}</span>}
                      </button>
                    </div>

                    {expandedKey === rowKey && (
                      <div className="tasks__actions">
                        {RESCHEDULE_BY_BUCKET[key].map((r) => (
                          <button
                            key={r.label}
                            className="tasks__action"
                            onClick={() => onReschedule(t, r.getDate(), r.label)}
                          >
                            {r.label}
                          </button>
                        ))}
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
    </div>
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
