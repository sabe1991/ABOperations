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
import { ListSkeleton } from '../../Skeleton'

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
function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return fmtLocalDate(new Date(y, m - 1, d + n))
}
function daysBetweenStr(aStr: string, bStr: string): number {
  const [ay, am, ad] = aStr.split('-').map(Number)
  const [by, bm, bd] = bStr.split('-').map(Number)
  const a = Date.UTC(ay, am - 1, ad)
  const b = Date.UTC(by, bm - 1, bd)
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}
function startMsOfDraft(draft: EventDraft): number {
  return draft.allDay
    ? new Date(`${draft.startDate}T00:00:00`).getTime()
    : new Date(`${draft.startDate}T${draft.startTime}:00`).getTime()
}

// 予定を「YYYY-MM-DD」の日付キーごとにグループ化する。
function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const groups = new Map<string, CalendarEvent[]>()
  for (const ev of events) {
    const d = new Date(ev.startMs)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const list = groups.get(key)
    if (list) list.push(ev)
    else groups.set(key, [ev])
  }
  return Array.from(groups.entries())
}

function formatDayHeader(ev: CalendarEvent): string {
  const d = new Date(ev.startMs)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 (${weekday})`
}

function formatTime(ev: CalendarEvent): string {
  if (ev.allDay || !ev.start) return '終日'
  return ev.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

type Snack = { text: string; undo: (() => void) | null }

export function CalendarPanel() {
  const { data: events, isLoading, isError, error } = useCalendarEvents()
  const { data: calendars } = useWritableCalendars()
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const del = useDeleteEvent()
  const restore = useRestoreEvent()

  // シート: 'create'（新規） / 編集対象の予定 / null（閉じる）
  const [sheet, setSheet] = useState<'create' | CalendarEvent | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 月カレンダーの日付クリックを受けて、その日の見出しへスクロールする。
  const { date: scrollDate, seq: scrollSeq } = useScrollToDateSignal()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollDate) return
    const el = rootRef.current?.querySelector(`[data-date="${scrollDate}"]`)
    if (el) (el as HTMLElement).scrollIntoView({ block: 'start', behavior: 'smooth' })
    // その日に予定が無い（見出しが無い）ときは何もしない。
  }, [scrollSeq, scrollDate])

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
    setExpandedId(null)
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
          onClick={() => setSheet('create')}
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
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onEdit={(ev) => {
            setSheet(ev)
            setExpandedId(null)
          }}
          onDelete={handleDelete}
        />
      </div>

      {sheet === 'create' && calendars && (
        <EventSheet
          mode="create"
          calendars={calendars}
          onClose={() => setSheet(null)}
          onSubmit={handleCreate}
        />
      )}
      {sheet && sheet !== 'create' && (
        <EventSheet
          mode="edit"
          event={sheet}
          calendars={calendars ?? []}
          onClose={() => setSheet(null)}
          onSubmit={(draft) => handleEditSave(sheet, draft)}
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
  expandedId,
  onToggleExpand,
  onEdit,
  onDelete,
}: {
  events: CalendarEvent[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onEdit: (ev: CalendarEvent) => void
  onDelete: (ev: CalendarEvent) => void
}) {
  // 出典名（カレンダー名 / 主カレンダーはメールアドレス）を表示するかは端末ローカルの設定に従う（既定は非表示）。
  const showLabels = useShowSourceLabels()
  if (isLoading) {
    return <ListSkeleton rows={5} />
  }
  if (isError) {
    return <p className="panel__note panel__note--error">予定の取得に失敗しました: {String(error)}</p>
  }
  if (!events || events.length === 0) {
    return <p className="panel__note">今後の予定はありません</p>
  }

  return (
    <>
      {groupByDay(events).map(([dayKey, dayEvents]) => (
        <section
          key={dayKey}
          className="calendar__day"
          data-date={fmtLocalDate(new Date(dayEvents[0].startMs))}
        >
          <h3 className="calendar__day-header">{formatDayHeader(dayEvents[0])}</h3>
          <ul className="calendar__events">
            {dayEvents.map((ev) => {
              const canEdit = ev.writable && !ev.pending
              return (
                <li key={`${ev.calendarId}:${ev.id}`} className="calendar__event-wrap">
                  <button
                    className="calendar__event"
                    // 読み取り専用の予定もタップで展開し、長いタイトルを全文表示できるようにする
                    // （編集・削除は下の canEdit のときだけ出す）。追加直後(pending)は操作不可。
                    onClick={() => !ev.pending && onToggleExpand(ev.id)}
                    disabled={ev.pending}
                    aria-expanded={expandedId === ev.id}
                  >
                    <span className="calendar__time">{formatTime(ev)}</span>
                    <span
                      className="calendar__dot"
                      style={{ backgroundColor: ev.calendarColor }}
                      aria-hidden
                    />
                    <span className="calendar__title-cell">
                      <span className="calendar__title">{ev.title}</span>
                      {ev.location && (
                        <span className="calendar__location">📍 {ev.location}</span>
                      )}
                    </span>
                    {showLabels && <span className="calendar__cal-name">{ev.calendarName}</span>}
                  </button>

                  {expandedId === ev.id && canEdit && (
                    <div className="tasks__actions">
                      {ev.isRecurringInstance && (
                        <span className="calendar__recur-note">繰り返し予定（この回のみ）</span>
                      )}
                      <button className="tasks__action" onClick={() => onEdit(ev)}>
                        編集
                      </button>
                      <button
                        className="tasks__action tasks__action--danger"
                        onClick={() => onDelete(ev)}
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
      ))}
    </>
  )
}

// 予定の作成・編集ボトムシート。
function EventSheet({
  mode,
  event,
  calendars,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  event?: CalendarEvent
  calendars: WritableCalendar[]
  onClose: () => void
  onSubmit: (draft: EventDraft) => void
}) {
  // 初期値。作成は「次の正時から1時間」、編集は既存予定から。
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
      : defaultCreateDraft(calendars[0]?.id ?? 'primary')

  // 既存予定の日数スパン（複数日予定を編集で潰さないよう保持）。
  const spanDays = daysBetweenStr(initial.startDate, initial.endDate)

  const [title, setTitle] = useState(initial.title)
  const [location, setLocation] = useState(initial.location)
  const [description, setDescription] = useState(initial.description)
  const [calendarId, setCalendarId] = useState(initial.calendarId)
  const [allDay, setAllDay] = useState(initial.allDay)
  const [date, setDate] = useState(initial.startDate)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    if (!allDay && startTime >= endTime && spanDays === 0) {
      setErrorMsg('終了時刻は開始時刻より後にしてください。')
      return
    }
    onSubmit({
      calendarId,
      title: trimmed,
      location: location.trim(),
      description: description.trim(),
      allDay,
      startDate: date,
      endDate: addDaysStr(date, spanDays),
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
        aria-label={mode === 'create' ? '予定を作成' : '予定を編集'}
      >
        <h3 className="sheet__title">{mode === 'create' ? '予定を作成' : '予定を編集'}</h3>

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
          autoFocus
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
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          終日
        </label>

        <label className="sheet__label" htmlFor="ev-date">
          日付
        </label>
        <input
          id="ev-date"
          className="tasks__add-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
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
              />
            </label>
            <label className="sheet__time-field">
              <span className="sheet__label">終了</span>
              <input
                className="tasks__add-input"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
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
          placeholder="場所（任意）"
        />

        <label className="sheet__label" htmlFor="ev-desc">
          メモ
        </label>
        <textarea
          id="ev-desc"
          className="tasks__add-input sheet__textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="詳細・メモ（任意）"
          rows={3}
        />

        {errorMsg && <p className="welcome__error">{errorMsg}</p>}

        <div className="sheet__buttons">
          <button type="button" className="btn btn--small" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn--small btn--primary" disabled={!title.trim()}>
            {mode === 'create' ? '作成' : '保存'}
          </button>
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
