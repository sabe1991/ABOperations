// カレンダーパネル（フェーズ2 読み取り + フェーズ4-c 作成・編集・削除）。
// 今日から7日分の予定を日付ごとにまとめて時系列表示する。
// - ＋予定: パネル上部のボタンでボトムシートを開き、予定を作成（作成先カレンダー選択・終日・日時）。
// - 予定タップ: 下に[編集][削除]を展開（書き込み可能なカレンダーの予定のみ）。
// - 削除: 即削除し「元に戻す」を5秒表示（Undo=status:"confirmed" で同じIDを復元）。
// - 繰り返し予定は「この回のみ」を対象にする（シリーズ全体の編集は純正へ）。

import { useEffect, useRef, useState } from 'react'
import { useCalendarEvents, useWritableCalendars } from './useCalendarEvents'
import {
  useCreateEvent,
  useDeleteEvent,
  useRestoreEvent,
  useUpdateEvent,
} from './useCalendarMutations'
import { isWithinUpcomingWindow } from './api'
import type { CalendarEvent, EventDraft, WritableCalendar } from './api'
import { useShowSourceLabels } from '../settings/displayPrefs'
import { useScrollToDateSignal } from './scrollTarget'
import { useCalendarSheetSignal } from './calendarSheetSignal'
import { ListSkeleton } from '../../Skeleton'
import { PanelError } from '../../ErrorBoundary'

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
}: {
  events: CalendarEvent[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  onSelect: (ev: CalendarEvent) => void
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
    return <p className="panel__note">今後の予定はありません。</p>
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
}: {
  mode: 'create' | 'edit'
  event?: CalendarEvent
  calendars: WritableCalendar[]
  createPrefill?: CreatePrefill
  readOnly?: boolean
  onClose: () => void
  onSubmit: (draft: EventDraft) => void
  onDelete?: () => void
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
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
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
          autoFocus={!readOnly}
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

        <label className="sheet__label" htmlFor="ev-start-date">
          開始日
        </label>
        <input
          id="ev-start-date"
          className="tasks__add-input"
          type="date"
          value={startDate}
          // 作成時のみ過去日を選べないようにする（#30）。編集時は既存日付を尊重して下限なし。
          min={mode === 'create' ? todayStr : undefined}
          onChange={(e) => handleStartDateChange(e.target.value)}
          disabled={readOnly}
        />

        <label className="sheet__label" htmlFor="ev-end-date">
          終了日
        </label>
        <input
          id="ev-end-date"
          className="tasks__add-input"
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
          disabled={readOnly}
        />

        {!allDay && (
          <div className="sheet__times">
            <label className="sheet__time-field">
              <span className="sheet__label">開始</span>
              <input
                className="tasks__add-input"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="sheet__time-field">
              <span className="sheet__label">終了</span>
              <input
                className="tasks__add-input"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={readOnly}
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
