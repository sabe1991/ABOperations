// カレンダーパネル（フェーズ2 読み取り + フェーズ4-c 作成・編集・削除）。
// 今日から7日分の予定を日付ごとにまとめて時系列表示する。
// - ＋予定: パネル上部のボタンでボトムシートを開き、予定を作成（作成先カレンダー選択・終日・日時）。
// - 予定タップ: 下に[編集][削除]を展開（書き込み可能なカレンダーの予定のみ）。
// - 削除: 即削除し「元に戻す」を5秒表示（Undo=status:"confirmed" で同じIDを復元）。
// - 繰り返し予定は「この回のみ」を対象にする（シリーズ全体の編集は純正へ）。

import { useEffect, useRef, useState } from 'react'
import { useCalendarEvents, useEventRecurrence, useWritableCalendars } from './useCalendarEvents'
import {
  useCreateEvent,
  useDeleteEvent,
  useRestoreEvent,
  useUpdateEvent,
  useUpdateRecurrence,
} from './useCalendarMutations'
import { isWithinUpcomingWindow } from './api'
import type { CalendarEvent, EventDraft, WritableCalendar } from './api'
import { defaultRule } from './recurrence'
import type { Freq, RecurrenceRule } from './recurrence'
import { useShowSourceLabels } from '../settings/displayPrefs'
import { useScrollToDateSignal } from './scrollTarget'
import { useCalendarSheetSignal } from './calendarSheetSignal'
import { ListSkeleton } from '../../Skeleton'
import { PanelError } from '../../ErrorBoundary'
import { useDialog } from '../../useDialog'

// 作成シートに渡す時刻プリフィル（タイムラインのドラッグ作成用）。null なら既定（次の正時から1時間）。
type CreatePrefill = { startDate: string; startTime: string; endTime: string } | null

// --- 日付・時刻の小ヘルパ（ローカル表記） ---
function fmtLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtLocalTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function startMsOfDraft(draft: EventDraft): number {
  return draft.allDay
    ? new Date(`${draft.startDate}T00:00:00`).getTime()
    : new Date(`${draft.startDate}T${draft.startTime}:00`).getTime()
}

// 予定を日付キー（'YYYY-MM-DD' ゼロ埋め）ごとにグループ化する。
// 進行中の複数日予定（今日より前に開始し、今日以降まで続く）は、実開始日（過去日）ではなく
// 「今日」のグループに寄せる（一覧は今日以降しか出さないので、過去日の見出しが最上部に出るのを防ぐ・#34）。
function groupByDay(events: CalendarEvent[], todayStr: string): [string, CalendarEvent[]][] {
  const groups = new Map<string, CalendarEvent[]>()
  for (const ev of events) {
    const key = ev.startDateStr < todayStr ? todayStr : ev.startDateStr
    const list = groups.get(key)
    if (list) list.push(ev)
    else groups.set(key, [ev])
  }
  return Array.from(groups.entries())
}

function formatDayHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()]
  return `${m}月${d}日 (${weekday})`
}

function formatTime(ev: CalendarEvent): string {
  if (ev.allDay || !ev.start) return '終日'
  return ev.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

type Snack = { text: string; undo: (() => void) | null }

export function CalendarPanel() {
  const { data: events, isLoading, isError, error, refetch } = useCalendarEvents()
  const { data: calendars } = useWritableCalendars()
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const del = useDeleteEvent()
  const restore = useRestoreEvent()

  // シート: 'create'（新規） / 編集対象の予定 / null（閉じる）
  const [sheet, setSheet] = useState<'create' | CalendarEvent | null>(null)
  // 繰り返しルール編集シートの対象（繰り返し予定のマスターに対して編集する・#3）。
  const [recurrenceTarget, setRecurrenceTarget] = useState<CalendarEvent | null>(null)
  // 作成シートの時刻プリフィル（タイムラインのドラッグ作成時のみ設定。＋予定ボタンでは null）。
  const [createPrefill, setCreatePrefill] = useState<CreatePrefill>(null)
  // シートを開くたびに増やす通し番号。EventSheet の key に使い、開き直し・対象差し替え時に
  // 必ず再マウントさせる（フォーム state が前の対象のまま残って別予定に保存されるのを防ぐ）。
  const [sheetSerial, setSheetSerial] = useState(0)

  // 作成シートを開く（prefill 無し=既定、有り=タイムラインのドラッグ作成）。
  function openCreate(prefill: CreatePrefill) {
    setCreatePrefill(prefill)
    setSheet('create')
    setSheetSerial((n) => n + 1)
  }
  // 予定のシートを開く。書き込み可能なら編集、読み取り専用なら詳細表示（場所・メモも見られる）。
  function openEdit(event: CalendarEvent) {
    setCreatePrefill(null)
    setSheet(event)
    setSheetSerial((n) => n + 1)
  }

  // 月カレンダーの日付クリックを受けて、その日の見出しへスクロールする。
  const { date: scrollDate, seq: scrollSeq } = useScrollToDateSignal()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollDate) return
    const el = rootRef.current?.querySelector(`[data-date="${scrollDate}"]`)
    if (el) (el as HTMLElement).scrollIntoView({ block: 'start', behavior: 'smooth' })
    // その日に予定が無い（見出しが無い）ときは何もしない。
  }, [scrollSeq, scrollDate])

  // 密度型タイムラインからの「編集シートを開く」「時刻プリフィルで作成シートを開く」シグナルを受ける（#18/#17）。
  const { request: sheetRequest, seq: sheetSeq } = useCalendarSheetSignal()
  useEffect(() => {
    if (!sheetRequest) return
    if (sheetRequest.kind === 'edit') {
      openEdit(sheetRequest.event)
    } else {
      openCreate({
        startDate: sheetRequest.startDate,
        startTime: sheetRequest.startTime,
        endTime: sheetRequest.endTime,
      })
    }
    // seq のみを依存にする（同じ内容の要求を連続で出しても発火させるため）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetSeq])

  const [snack, setSnack] = useState<Snack | null>(null)
  const snackTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(snackTimer.current), [])
  function showSnack(text: string, undo: (() => void) | null) {
    window.clearTimeout(snackTimer.current)
    setSnack({ text, undo })
    snackTimer.current = window.setTimeout(() => setSnack(null), 5000)
  }
  function handleSnackUndo() {
    if (snack?.undo) snack.undo()
    window.clearTimeout(snackTimer.current)
    setSnack(null)
  }

  function calMeta(calendarId: string): { name: string; color: string } {
    const c = calendars?.find((x) => x.id === calendarId)
    return { name: c?.name ?? '', color: c?.color ?? '#5484ed' }
  }

  function handleCreate(draft: EventDraft) {
    const { name, color } = calMeta(draft.calendarId)
    create.mutate({ draft, calendarName: name, calendarColor: color })
    setSheet(null)
    // 7日以降に作った予定は一覧に出ないので、その旨を伝える
    if (!isWithinUpcomingWindow(startMsOfDraft(draft))) {
      showSnack('予定を作成しました（5週間より先のため一覧には表示されません）', null)
    }
  }

  function handleEditSave(event: CalendarEvent, draft: EventDraft) {
    update.mutate({ event, draft })
    setSheet(null)
  }

  // 繰り返しルール編集を開く（編集シートを閉じてから繰り返しシートを出す・#3）。
  function openRecurrence(event: CalendarEvent) {
    setSheet(null)
    setRecurrenceTarget(event)
  }

  function handleDelete(event: CalendarEvent) {
    del.mutate(event)
    setSheet(null)
    showSnack(
      `「${event.title}」を削除しました${event.isRecurringInstance ? '（この回のみ）' : ''}`,
      () => restore.mutate(event),
    )
  }

  return (
    <div className="calendar" ref={rootRef}>
      {/* 見出しと「＋予定」ボタンを同じ行に並べる（両端揃え）。 */}
      <div className="calendar__toolbar">
        <h2 className="panel__title">今後の予定</h2>
        <button
          className="btn btn--small btn--primary"
          onClick={() => openCreate(null)}
          disabled={!calendars || calendars.length === 0}
        >
          ＋ 予定
        </button>
      </div>

      <div className="calendar__scroll">
        <EventList
          events={events}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          onSelect={openEdit}
          onCreate={calendars && calendars.length > 0 ? () => openCreate(null) : undefined}
        />
      </div>

      {sheet === 'create' && calendars && (
        <EventSheet
          key={sheetSerial}
          mode="create"
          calendars={calendars}
          createPrefill={createPrefill}
          onClose={() => setSheet(null)}
          onSubmit={handleCreate}
        />
      )}
      {sheet && sheet !== 'create' && (
        <EventSheet
          key={sheetSerial}
          mode="edit"
          event={sheet}
          calendars={calendars ?? []}
          // 書き込み権限のない予定は読み取り専用で詳細（場所・メモ含む）を表示する。
          readOnly={!sheet.writable}
          onClose={() => setSheet(null)}
          onSubmit={(draft) => handleEditSave(sheet, draft)}
          onDelete={sheet.writable ? () => handleDelete(sheet) : undefined}
          // 書き込み可能な繰り返し予定でのみ「繰り返しルールを編集」を出す（#3）。
          onEditRecurrence={
            sheet.isRecurringInstance && sheet.writable && sheet.recurringEventId
              ? () => openRecurrence(sheet)
              : undefined
          }
        />
      )}

      {recurrenceTarget && (
        <RecurrenceSheet
          event={recurrenceTarget}
          onClose={() => setRecurrenceTarget(null)}
          onSaved={() => {
            setRecurrenceTarget(null)
            showSnack('繰り返しルールを変更しました', null)
          }}
        />
      )}

      {snack && (
        <div className="snackbar" role="status">
          <span className="snackbar__text">{snack.text}</span>
          {snack.undo && (
            <button className="snackbar__action" onClick={handleSnackUndo}>
              元に戻す
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function EventList({
  events,
  isLoading,
  isError,
  error,
  onRetry,
  onSelect,
  onCreate,
}: {
  events: CalendarEvent[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  onSelect: (ev: CalendarEvent) => void
  onCreate?: () => void
}) {
  // 出典名（カレンダー名 / 主カレンダーはメールアドレス）を表示するかは端末ローカルの設定に従う（既定は非表示）。
  const showLabels = useShowSourceLabels()
  if (isLoading) {
    return <ListSkeleton rows={5} />
  }
  if (isError) {
    return <PanelError message="予定の取得に失敗しました" error={error} onRetry={onRetry} />
  }
  if (!events || events.length === 0) {
    // 空のときは、次の一手（予定作成）へ誘導する CTA を出す（#67）。
    return (
      <div className="empty-state">
        <p className="empty-state__text">今後の予定はありません。</p>
        {onCreate && (
          <button className="btn btn--small btn--primary" onClick={onCreate}>
            ＋ 予定を作成
          </button>
        )}
      </div>
    )
  }

  const todayStr = fmtLocalDate(new Date())
  return (
    <>
      {groupByDay(events, todayStr).map(([dayStr, dayEvents]) => (
        <section key={dayStr} className="calendar__day" data-date={dayStr}>
          <h3 className="calendar__day-header">{formatDayHeader(dayStr)}</h3>
          <ul className="calendar__events">
            {dayEvents.map((ev) => (
              <li key={`${ev.calendarId}:${ev.id}`} className="calendar__event-wrap">
                <button
                  className="calendar__event"
                  // 予定をタップすると詳細シートを開く（書き込み可能なら編集、読み取り専用なら
                  // 場所・メモも見られる詳細表示）。追加直後(pending)は操作不可。
                  onClick={() => !ev.pending && onSelect(ev)}
                  disabled={ev.pending}
                >
                  <span className="calendar__time">{formatTime(ev)}</span>
                  <span
                    className="calendar__dot"
                    style={{ backgroundColor: ev.calendarColor }}
                    aria-hidden
                  />
                  <span className="calendar__title-cell">
                    <span className="calendar__title">{ev.title}</span>
                    {ev.location && <span className="calendar__location">📍 {ev.location}</span>}
                  </span>
                  {showLabels && <span className="calendar__cal-name">{ev.calendarName}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

// 予定の作成・編集・詳細ボトムシート。
// readOnly=true（書き込み権限のない予定）のときは入力を無効化し、場所・メモも含めて閲覧だけできる。
// onDelete があれば（書き込み可能な予定の編集時）フッタに削除ボタンを出す。
function EventSheet({
  mode,
  event,
  calendars,
  createPrefill,
  readOnly = false,
  onClose,
  onSubmit,
  onDelete,
  onEditRecurrence,
}: {
  mode: 'create' | 'edit'
  event?: CalendarEvent
  calendars: WritableCalendar[]
  createPrefill?: CreatePrefill
  readOnly?: boolean
  onClose: () => void
  onSubmit: (draft: EventDraft) => void
  onDelete?: () => void
  // 繰り返し予定のとき、シリーズ全体の繰り返しルールを編集する導線（#3）。
  onEditRecurrence?: () => void
}) {
  // 初期値。編集は既存予定から。作成は既定「次の正時から1時間」だが、
  // タイムラインのドラッグ作成（createPrefill）があればその日付・時刻で上書きする（#17 Phase A）。
  const initial: EventDraft =
    event !== undefined
      ? {
          calendarId: event.calendarId,
          title: event.title,
          location: event.location,
          description: event.description,
          allDay: event.allDay,
          startDate: event.startDateStr,
          endDate: event.endDateStr,
          startTime: event.startTimeStr ?? '09:00',
          endTime: event.endTimeStr ?? '10:00',
        }
      : applyPrefill(defaultCreateDraft(calendars[0]?.id ?? 'primary'), createPrefill)

  // 作成時は過去日を選べないよう開始日の下限を今日にする（#30）。編集は既存の日付を尊重して下限なし。
  const todayStr = fmtLocalDate(new Date())

  const [title, setTitle] = useState(initial.title)
  const [location, setLocation] = useState(initial.location)
  const [description, setDescription] = useState(initial.description)
  const [calendarId, setCalendarId] = useState(initial.calendarId)
  const [allDay, setAllDay] = useState(initial.allDay)
  // 開始日・終了日を別々に持ち、複数日予定の作成・編集に対応する（#10）。
  const [startDate, setStartDate] = useState(initial.startDate)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ダイアログ共通挙動（Esc で閉じる・フォーカストラップ・スクロールロック・端末に応じた初期フォーカス）。
  const dialogRef = useDialog<HTMLFormElement>(onClose)

  // 開始日を変えたら、終了日が前になっていれば開始日に合わせる（終了日<開始日を作らせない）。
  function handleStartDateChange(value: string) {
    setStartDate(value)
    if (endDate < value) setEndDate(value)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly) return
    const trimmed = title.trim()
    if (!trimmed) return
    if (endDate < startDate) {
      setErrorMsg('終了日は開始日以降にしてください。')
      return
    }
    // 同一日の時刻あり予定は、終了時刻が開始時刻より後である必要がある（複数日なら時刻の前後は不問）。
    if (!allDay && startDate === endDate && startTime >= endTime) {
      setErrorMsg('終了時刻は開始時刻より後にしてください。')
      return
    }
    onSubmit({
      calendarId,
      title: trimmed,
      location: location.trim(),
      description: description.trim(),
      allDay,
      startDate,
      endDate,
      startTime,
      endTime,
    })
  }

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
        aria-label={mode === 'create' ? '予定を作成' : readOnly ? '予定の詳細' : '予定を編集'}
      >
        <h3 className="sheet__title">
          {mode === 'create' ? '予定を作成' : readOnly ? '予定の詳細' : '予定を編集'}
        </h3>

        <label className="sheet__label" htmlFor="ev-title">
          タイトル
        </label>
        <input
          id="ev-title"
          className="tasks__add-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="予定のタイトル"
          disabled={readOnly}
        />

        {mode === 'create' && calendars.length > 1 && (
          <>
            <label className="sheet__label" htmlFor="ev-cal">
              カレンダー
            </label>
            <select
              id="ev-cal"
              className="tasks__add-input"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="sheet__row-check">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            disabled={readOnly}
          />
          終日
        </label>

        {/* 日付は「開始日｜終了日」、時刻は「開始時刻｜終了時刻」を左右2列に並べる。
            終了日の真下に終了時刻が来るので、終了の日時が視覚的にまとまる（ユーザー要望）。 */}
        <div className="sheet__times">
          <label className="sheet__time-field">
            <span className="sheet__label">開始日</span>
            <input
              className="tasks__add-input"
              type="date"
              value={startDate}
              // 作成時のみ過去日を選べないようにする（#30）。編集時は既存日付を尊重して下限なし。
              min={mode === 'create' ? todayStr : undefined}
              onChange={(e) => handleStartDateChange(e.target.value)}
              disabled={readOnly}
              aria-label="開始日"
            />
          </label>
          <label className="sheet__time-field">
            <span className="sheet__label">終了日</span>
            <input
              className="tasks__add-input"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={readOnly}
              aria-label="終了日"
            />
          </label>
        </div>

        {!allDay && (
          <div className="sheet__times">
            <label className="sheet__time-field">
              <span className="sheet__label">開始時刻</span>
              <input
                className="tasks__add-input"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={readOnly}
                aria-label="開始時刻"
              />
            </label>
            <label className="sheet__time-field">
              <span className="sheet__label">終了時刻</span>
              <input
                className="tasks__add-input"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={readOnly}
                aria-label="終了時刻"
              />
            </label>
          </div>
        )}

        <label className="sheet__label" htmlFor="ev-location">
          場所
        </label>
        <input
          id="ev-location"
          className="tasks__add-input"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={readOnly ? '（場所なし）' : '場所（任意）'}
          disabled={readOnly}
        />

        <label className="sheet__label" htmlFor="ev-desc">
          メモ
        </label>
        <textarea
          id="ev-desc"
          className="tasks__add-input sheet__textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={readOnly ? '（メモなし）' : '詳細・メモ（任意）'}
          rows={3}
          disabled={readOnly}
        />

        {/* 繰り返し予定の編集導線（#3）。上の各項目は「この回のみ」に効くのに対し、
            こちらはシリーズ全体の繰り返し方（毎週→隔週など）を変える別操作であることを明示する。 */}
        {onEditRecurrence && !readOnly && (
          <div className="sheet__recurrence">
            <p className="panel__note sheet__recurrence-note">
              上の変更は「この回のみ」に適用されます。繰り返し方（毎週・隔週など）自体を変えるには
              下のボタンから編集してください。
            </p>
            <button type="button" className="btn btn--small" onClick={onEditRecurrence}>
              🔁 繰り返しルールを編集…
            </button>
          </div>
        )}

        {errorMsg && <p className="welcome__error">{errorMsg}</p>}

        <div className="sheet__buttons">
          {/* 書き込み可能な予定の編集時のみ、削除ボタンを左端に置く。 */}
          {onDelete && !readOnly && (
            <button
              type="button"
              className="btn btn--small sheet__btn-delete"
              onClick={onDelete}
            >
              削除
            </button>
          )}
          <button type="button" className="btn btn--small" onClick={onClose}>
            {readOnly ? '閉じる' : 'キャンセル'}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn--small btn--primary" disabled={!title.trim()}>
              {mode === 'create' ? '作成' : '保存'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// タイムラインのドラッグ作成の時刻プリフィルを下書きに反映する（時刻ありの単日予定に固定）。
// prefill が無ければ既定の下書きをそのまま返す。
function applyPrefill(draft: EventDraft, prefill?: CreatePrefill): EventDraft {
  if (!prefill) return draft
  return {
    ...draft,
    allDay: false,
    startDate: prefill.startDate,
    endDate: prefill.startDate,
    startTime: prefill.startTime,
    endTime: prefill.endTime,
  }
}

// 繰り返しルール編集シート（#3）。マスター予定の RRULE を読み、頻度・間隔・終了条件を
// 編集してシリーズ全体に適用する。「毎週→隔週」などをアプリ内で完結させるのが狙い。
function RecurrenceSheet({
  event,
  onClose,
  onSaved,
}: {
  event: CalendarEvent
  onClose: () => void
  onSaved: () => void
}) {
  const masterId = event.recurringEventId as string
  const { data: rule, isLoading, isError } = useEventRecurrence(event.calendarId, masterId)
  const update = useUpdateRecurrence()
  const dialogRef = useDialog<HTMLFormElement>(onClose)

  // 編集中のルール。取得完了後に一度だけ初期値を入れる（ユーザーの編集を上書きしない）。
  const [draft, setDraft] = useState<RecurrenceRule | null>(null)
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current || isLoading) return
    initRef.current = true
    // rule が null（=このアプリでは扱えない複雑な RRULE）のときは編集不可として扱う。
    setDraft(rule ?? null)
  }, [isLoading, rule])

  // このアプリで扱えない繰り返し設定（rule=null かつ取得成功）か。
  const unsupported = !isLoading && !isError && rule == null

  function patch(part: Partial<RecurrenceRule>) {
    setDraft((d) => ({ ...(d ?? defaultRule()), ...part }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    update.mutate(
      { calendarId: event.calendarId, masterEventId: masterId, rule: draft, allDay: event.allDay },
      { onSuccess: onSaved },
    )
  }

  const end = draft?.end ?? { type: 'never' }

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
        aria-label="繰り返しルールを編集"
      >
        <h3 className="sheet__title">繰り返しルールを編集</h3>
        <p className="panel__note">「{event.title}」の繰り返し方をシリーズ全体で変更します。</p>

        {isLoading && <p className="panel__note">繰り返しルールを読み込み中…</p>}
        {isError && <p className="welcome__error">繰り返しルールの取得に失敗しました。</p>}
        {unsupported && (
          <p className="panel__note">
            この予定は、このアプリでは編集できない繰り返し設定（曜日指定など）です。変更は Google
            カレンダー本家で行ってください。
          </p>
        )}

        {draft && !unsupported && (
          <>
            <label className="sheet__label" htmlFor="rec-freq">
              繰り返し
            </label>
            <select
              id="rec-freq"
              className="tasks__add-input"
              value={draft.freq}
              onChange={(e) => patch({ freq: e.target.value as Freq })}
            >
              <option value="DAILY">日ごと</option>
              <option value="WEEKLY">週ごと</option>
              <option value="MONTHLY">月ごと</option>
              <option value="YEARLY">年ごと</option>
            </select>

            <label className="sheet__label" htmlFor="rec-interval">
              間隔（1=毎回・2=1つおき …）
            </label>
            <input
              id="rec-interval"
              className="tasks__add-input"
              type="number"
              min={1}
              max={99}
              value={draft.interval}
              onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
            />

            <label className="sheet__label" htmlFor="rec-end">
              終了
            </label>
            <select
              id="rec-end"
              className="tasks__add-input"
              value={end.type}
              onChange={(e) => {
                const t = e.target.value
                if (t === 'never') patch({ end: { type: 'never' } })
                else if (t === 'count') patch({ end: { type: 'count', count: 10 } })
                else patch({ end: { type: 'until', date: event.startDateStr } })
              }}
            >
              <option value="never">終了日なし</option>
              <option value="count">回数で終了</option>
              <option value="until">日付で終了</option>
            </select>

            {end.type === 'count' && (
              <input
                className="tasks__add-input"
                type="number"
                min={1}
                max={999}
                value={end.count}
                onChange={(e) =>
                  patch({ end: { type: 'count', count: Math.max(1, Number(e.target.value) || 1) } })
                }
                aria-label="繰り返し回数"
              />
            )}
            {end.type === 'until' && (
              <input
                className="tasks__add-input"
                type="date"
                value={end.date}
                onChange={(e) => patch({ end: { type: 'until', date: e.target.value } })}
                aria-label="繰り返しの終了日"
              />
            )}
          </>
        )}

        <div className="sheet__buttons">
          <button type="button" className="btn btn--small" onClick={onClose}>
            {unsupported || isError ? '閉じる' : 'キャンセル'}
          </button>
          {draft && !unsupported && (
            <button
              type="submit"
              className="btn btn--small btn--primary"
              disabled={update.isPending}
            >
              {update.isPending ? '保存中…' : '保存'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// 作成の初期下書き: 次の正時から1時間の予定。
function defaultCreateDraft(calendarId: string): EventDraft {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)
  const dateStr = fmtLocalDate(start)
  return {
    calendarId,
    title: '',
    location: '',
    description: '',
    allDay: false,
    startDate: dateStr,
    endDate: dateStr,
    startTime: fmtLocalTime(start),
    endTime: fmtLocalTime(end),
  }
}
