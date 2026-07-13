// タスクパネル（フェーズ4-a/4-b: 読み取り + 完了 + クイック追加 + 明日へ/来週へ・編集・削除）。
// 全リストの未完了タスクを「⚠期限切れ/今日/明日/今週/以降/期限なし」の6バケツで表示する。
// 密度型（≥1200px）ではこのバケツを横並びの多列カラムにし（かんばん風）、狭い幅では縦積みにする。
// - 完了: 左の丸チェックで即完了。誤タップ対策に画面下部へ「元に戻す」を5秒表示（Undo=reopen）。
// - 行タップ: 予定と同じく編集ボトムシートを直接開く（タイトル・期限を変更）。
// - 編集シート内: 期限（なし/今日/明日/日付指定）変更と「削除」ができる。
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
import { requestQuickAddFocus, useQuickAddFocusSignal } from './quickAddFocus'
import { useAuth } from '../../auth/useAuth'
import { useShowSourceLabels } from '../settings/displayPrefs'
import { ListSkeleton } from '../../Skeleton'
import { PanelError } from '../../ErrorBoundary'
import { useDialog } from '../../useDialog'

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
  const { data: tasks, isLoading, isError, error, refetch } = useTasks()
  const complete = useCompleteTask()
  const reopen = useReopenTask()
  const insert = useInsertTask()
  const update = useUpdateTask()
  const del = useDeleteTask()

  // スナックバー（完了/移動/削除の Undo）。直近1件のみ・Query キャッシュ外のローカル state。
  const [snack, setSnack] = useState<Snack | null>(null)
  const snackTimer = useRef<number | undefined>(undefined)

  // 編集ボトムシートで開いているタスク（行タップで開く）。
  const [editing, setEditing] = useState<TaskItem | null>(null)

  // クイック追加フォームの入力。
  const [newTitle, setNewTitle] = useState('')
  const [dueToday, setDueToday] = useState(false)
  // 「/」ショートカット（#7）でクイック追加入力へフォーカスするためのシグナル購読。
  const addInputRef = useRef<HTMLInputElement>(null)
  const quickAddSeq = useQuickAddFocusSignal()
  useEffect(() => {
    if (quickAddSeq === 0) return // 初回（未要求）はフォーカスしない
    const el = addInputRef.current
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
      el.focus()
    }
  }, [quickAddSeq])

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
    setEditing(null) // 削除は編集シートから行うのでシートを閉じる
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
      {/* クイック追加フォーム（常に表示）。入力・「今日」チェック・追加ボタンを1行に並べて縦を節約する。 */}
      <form className="tasks__add" onSubmit={handleAdd}>
        <input
          ref={addInputRef}
          className="tasks__add-input"
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="タスクを追加…"
          aria-label="新しいタスクのタイトル"
        />
        <label className="tasks__add-check">
          <input type="checkbox" checked={dueToday} onChange={(e) => setDueToday(e.target.checked)} />
          今日
        </label>
        <button type="submit" className="btn btn--small btn--primary" disabled={!newTitle.trim()}>
          追加
        </button>
      </form>

      <div className="tasks__scroll">
        <TaskList
          tasks={tasks}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          onComplete={handleComplete}
          onEdit={(t) => setEditing(t)}
        />
      </div>

      {/* 編集ボトムシート（行タップで開く。削除もこの中から行う） */}
      {editing && (
        <EditSheet
          task={editing}
          onClose={() => setEditing(null)}
          onSave={handleSaveEdit}
          onDelete={handleDelete}
          onComplete={(t) => {
            handleComplete(t) // 完了にして Undo スナックを出す
            setEditing(null) // シートを閉じる
          }}
        />
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
  onRetry,
  onComplete,
  onEdit,
}: {
  tasks: TaskItem[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  onComplete: (task: TaskItem) => void
  onEdit: (task: TaskItem) => void
}) {
  // 出典名（リスト名）を表示するかは端末ローカルの表示設定に従う（既定は非表示）。
  const showLabels = useShowSourceLabels()
  if (isLoading) {
    return <ListSkeleton rows={5} />
  }
  if (isError) {
    return <PanelError message="タスクの取得に失敗しました" error={error} onRetry={onRetry} />
  }
  if (!tasks || tasks.length === 0) {
    // 空のときは、常設のクイック追加入力へ誘導する CTA を出す（#67）。
    return (
      <div className="empty-state">
        <p className="empty-state__text">タスクはありません。すべて順調です。</p>
        <button className="btn btn--small btn--primary" onClick={() => requestQuickAddFocus()}>
          ＋ タスクを追加
        </button>
      </div>
    )
  }

  const groups = bucketTasks(tasks)

  return (
    // 密度型（≥1200px）ではこのラッパを flex 多列にしてバケツを横並びにする（CSS 側で制御）。
    <div className="tasks__groups">
      {GROUP_ORDER.map(({ key, label, variant }) => {
        const items = groups[key]
        if (items.length === 0) return null
        return (
          <TaskBucket
            key={key}
            bucketKey={key}
            label={label}
            variant={variant}
            items={items}
            showLabels={showLabels}
            onComplete={onComplete}
            onEdit={onEdit}
          />
        )
      })}
    </div>
  )
}

// 1バケツ（期限切れ／今日…）の描画。1列に多数のタスクがあると縦に長くなるため、
// VISIBLE 件を超える分は初期状態で隠し、「他 N 件 ▽」で展開できるようにする（ユーザー要望）。
const VISIBLE = 10
function TaskBucket({
  bucketKey,
  label,
  variant,
  items,
  showLabels,
  onComplete,
  onEdit,
}: {
  bucketKey: Bucket
  label: string
  variant: string
  items: TaskItem[]
  showLabels: boolean
  onComplete: (task: TaskItem) => void
  onEdit: (task: TaskItem) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const overflow = items.length - VISIBLE
  const visibleItems = showAll ? items : items.slice(0, VISIBLE)
  return (
    <section className="tasks__group">
      <h3 className={`tasks__group-header tasks__group-header--${variant}`}>
        {label} <span className="tasks__count">{items.length}</span>
      </h3>
      <ul className="tasks__list">
        {visibleItems.map((t) => {
          const rowKey = `${t.listId}:${t.id}`
          // 日付が自明でないバケツ（期限切れ/以降）でだけ期限を表示する。
          const showDue = (bucketKey === 'overdue' || bucketKey === 'later') && t.dueStr
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
                {/* 行本体タップで編集シートを開く（予定パネルと同じ挙動）。追加直後(pending)は操作不可 */}
                <button
                  className="tasks__row"
                  onClick={() => !t.pending && onEdit(t)}
                  disabled={t.pending}
                >
                  {/* 期限は日付が自明でないバケツ（期限切れ/今週/以降）でだけ表示。
                      今日/明日/期限なしは日付欄ごと描画しない（余白を残さない）。 */}
                  {showDue && <span className="tasks__due">{formatDue(t.dueStr)}</span>}
                  <span className="tasks__title">{t.title}</span>
                  {showLabels && <span className="tasks__list-name">{t.listName}</span>}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {overflow > 0 && (
        <button className="tasks__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? '閉じる ▲' : `他 ${overflow} 件 ▽`}
        </button>
      )}
    </section>
  )
}

// 編集ボトムシート。タイトルと期限（なし/今日/明日/日付指定）を変更して保存する。
function EditSheet({
  task,
  onClose,
  onSave,
  onDelete,
  onComplete,
}: {
  task: TaskItem
  onClose: () => void
  onSave: (task: TaskItem, patch: { title: string; dueDateStr: string | null }) => void
  onDelete: (task: TaskItem) => void
  onComplete: (task: TaskItem) => void
}) {
  const today = localTodayStr()
  const tomorrow = localDateStrPlusDays(1)
  const nextMonday = localNextMondayStr()

  type DueMode = 'none' | 'today' | 'tomorrow' | 'nextweek' | 'custom'
  const initialMode: DueMode = !task.dueStr
    ? 'none'
    : task.dueStr === today
      ? 'today'
      : task.dueStr === tomorrow
        ? 'tomorrow'
        : task.dueStr === nextMonday
          ? 'nextweek'
          : 'custom'

  const [title, setTitle] = useState(task.title)
  const [dueMode, setDueMode] = useState<DueMode>(initialMode)
  // 「日付指定」で使う値。初期は既存期限（今日/明日/なしなら今日を初期表示）。
  const [customDate, setCustomDate] = useState(
    initialMode === 'custom' && task.dueStr ? task.dueStr : today,
  )

  // ダイアログ共通挙動（Esc で閉じる・フォーカストラップ・スクロールロック・端末に応じた初期フォーカス）。
  const dialogRef = useDialog<HTMLFormElement>(onClose)

  function resolveDue(): string | null {
    switch (dueMode) {
      case 'none':
        return null
      case 'today':
        return today
      case 'tomorrow':
        return tomorrow
      case 'nextweek':
        return nextMonday
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
    { mode: 'nextweek', label: '来週' },
    { mode: 'custom', label: '日付指定' },
  ]

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        ref={dialogRef}
        tabIndex={-1}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
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

        {/* タスクは Google Tasks の仕様上「日付」までしか持てず、時刻（何時）は設定できない。
            時刻付きで管理したいものはカレンダー予定へ、と使い分けを案内する（#9）。 */}
        <p className="sheet__hint">
          タスクは日付単位です（時刻は設定できません）。時刻が必要な予定はカレンダーへ登録してください。
        </p>

        <div className="sheet__buttons">
          {/* 完了・削除はタスクのライフサイクル操作なので左側にまとめ、右のキャンセル/保存（フォーム操作）と分ける。
              どちらも押し間違えても Undo で戻せる。 */}
          <button
            type="button"
            className="btn btn--small sheet__btn-complete"
            onClick={() => onComplete(task)}
          >
            ✓ 完了
          </button>
          <button
            type="button"
            className="btn btn--small sheet__btn-delete"
            onClick={() => onDelete(task)}
          >
            削除
          </button>
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
