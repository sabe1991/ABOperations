// Google Calendar API の呼び出し。
// フェーズ2の縦切りスコープ: 全カレンダーを取得し、今日から7日分の予定を時系列で返す。
// 色分け・詳細表示・厳密なタイムゾーン対応はフェーズ3以降（ここでは素朴な表示に留める）。

import { ApiError, fetchJson } from '../../google/fetchJson'
import { fulfilledValues, mapPool, throwIfAllRejected } from '../../google/pool'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

// カレンダーごとの予定取得の同時実行数の上限。
const CAL_FETCH_CONCURRENCY = 8

// 端末のタイムゾーン（例 "Asia/Tokyo"）。events.insert/patch の dateTime に添えて送る。
function getTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

// 'YYYY-MM-DD' に n 日足した 'YYYY-MM-DD' を返す（終日予定の排他的 end 計算などに使う）。
function addDaysToDateStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return formatLocalDate(dt)
}

// Date → ローカルの 'YYYY-MM-DD'（toISOString を使わず TZ ズレを回避）。
function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Date → ローカルの 'HH:mm'。
function formatLocalTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// --- API レスポンスの型（必要な項目だけ）---

interface CalendarListResponse {
  items?: CalendarListEntry[]
}

export interface CalendarListEntry {
  id: string
  summary: string
  backgroundColor?: string
  // 非表示・非選択のカレンダーを除外する判定に使う
  selected?: boolean
  // 権限（owner/writer/reader/freeBusyReader）。作成先を書き込み可能なものに絞るのに使う。
  accessRole?: string
  primary?: boolean
}

// 予定を作成できるカレンダー（owner/writer のみ）。作成フォームの選択肢に使う。
export interface WritableCalendar {
  id: string
  name: string
  color: string
  primary: boolean
}

interface EventsResponse {
  items?: GoogleEvent[]
}

interface GoogleEvent {
  id: string
  summary?: string
  status?: string
  location?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  recurringEventId?: string
}

// --- 画面で扱う正規化済みの予定 ---

export interface CalendarEvent {
  id: string
  title: string
  calendarId: string
  calendarName: string
  calendarColor: string
  // 場所・詳細メモ（無ければ空文字）
  location: string
  description: string
  // 終日予定かどうか
  allDay: boolean
  // 並べ替え用のソートキー（開始時刻の数値）。終日予定はその日の0時扱い。
  startMs: number
  // 表示用の開始時刻（終日予定は null）
  start: Date | null
  // 編集フォームのプリフィル用（ローカル表記）。
  startDateStr: string // 'YYYY-MM-DD'
  endDateStr: string // 'YYYY-MM-DD'（終日は「含む最終日」= 排他end-1日）
  startTimeStr: string | null // 'HH:mm'（終日は null）
  endTimeStr: string | null // 'HH:mm'（終日は null）
  // 繰り返し予定の1回（インスタンス）か。編集・削除の扱いを分けるのに使う。
  isRecurringInstance: boolean
  // 繰り返しの親（マスター）予定のID。繰り返しルール自体（毎週→隔週など）の編集に使う（#3）。
  // 単発予定では undefined。
  recurringEventId?: string
  // このカレンダーに書き込み権限（owner/writer）があるか。編集・削除ボタンの出し分けに使う。
  writable: boolean
  // 楽観的作成でまだサーバーIDが無い仮の予定。true の間は編集・削除を不可にする。
  pending?: boolean
}

// カレンダー一覧を取得する。全機能（予定取得・月ドット・作成先一覧・アカウントメール）で
// 共有する生データ。呼び出し側は useCalendarList でキャッシュ1本に集約する（#32）。
export async function fetchCalendarList(): Promise<CalendarListEntry[]> {
  const res = await fetchJson<CalendarListResponse>(`${CAL_BASE}/users/me/calendarList`)
  return res.items ?? []
}

// 1つのカレンダーから、指定期間の予定を取得する。
// singleEvents=true で繰り返し予定を各回に展開して受け取る。
async function fetchEventsForCalendar(
  cal: CalendarListEntry,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
    maxResults: '250',
  })
  const res = await fetchJson<EventsResponse>(
    `${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`,
  )
  const color = cal.backgroundColor ?? '#5484ed'
  const writable = cal.accessRole === 'owner' || cal.accessRole === 'writer'
  const events: CalendarEvent[] = []
  for (const ev of res.items ?? []) {
    if (ev.status === 'cancelled') continue
    const allDay = Boolean(ev.start?.date)
    let startMs: number
    let start: Date | null
    let startDateStr: string
    let endDateStr: string
    let startTimeStr: string | null
    let endTimeStr: string | null
    if (allDay && ev.start?.date) {
      // 終日予定: 日付のみ。その日のローカル0時をソートキーにする。
      start = null
      startMs = new Date(`${ev.start.date}T00:00:00`).getTime()
      startDateStr = ev.start.date
      startTimeStr = null
      endTimeStr = null
      // end.date は排他的（翌日）なので、表示・編集用は1日戻した「含む最終日」にする。
      endDateStr = ev.end?.date ? addDaysToDateStr(ev.end.date, -1) : ev.start.date
    } else if (ev.start?.dateTime) {
      start = new Date(ev.start.dateTime)
      startMs = start.getTime()
      startDateStr = formatLocalDate(start)
      startTimeStr = formatLocalTime(start)
      const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : start
      endDateStr = formatLocalDate(end)
      endTimeStr = formatLocalTime(end)
    } else {
      continue
    }
    events.push({
      id: ev.id,
      title: ev.summary ?? '(タイトルなし)',
      calendarId: cal.id,
      calendarName: cal.summary,
      calendarColor: color,
      location: ev.location ?? '',
      description: ev.description ?? '',
      allDay,
      startMs,
      start,
      startDateStr,
      endDateStr,
      startTimeStr,
      endTimeStr,
      isRecurringInstance: Boolean(ev.recurringEventId),
      recurringEventId: ev.recurringEventId,
      writable,
    })
  }
  return events
}

// 一覧に表示する期間（今日から何日先まで）。ミニカレンダーの表示範囲（今週から5週間＝35日）に
// 合わせ、カレンダー上でクリックできる日の予定が必ず一覧に載るようにする（ユーザー要望）。
// 予定・タスクで同じ値を使う。
export const UPCOMING_DAYS = 35

// 今日から UPCOMING_DAYS 日分の全カレンダーの予定を、開始時刻順にまとめて取得する。
// カレンダー一覧は呼び出し側（useCalendarEvents）が共有クエリから渡す（#32）。
export async function fetchUpcomingEvents(calendars: CalendarListEntry[]): Promise<CalendarEvent[]> {
  // 今日のローカル0時から UPCOMING_DAYS 日後まで
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const windowEnd = new Date(startOfToday.getTime())
  windowEnd.setDate(windowEnd.getDate() + UPCOMING_DAYS)
  const timeMin = startOfToday.toISOString()
  const timeMax = windowEnd.toISOString()

  const selected = calendars.filter((c) => c.selected !== false)

  // カレンダーごとに並列取得（同時実行数は上限を設ける）。1つのカレンダーが一時的に
  // 5xx/429 を返しても他の予定は表示できるよう、成功分だけ採用する（部分失敗を許容）。
  const settled = await mapPool(selected, CAL_FETCH_CONCURRENCY, (cal) =>
    fetchEventsForCalendar(cal, timeMin, timeMax),
  )
  throwIfAllRejected(settled)
  return fulfilledValues(settled)
    .flat()
    .sort((a, b) => a.startMs - b.startMs)
}

// 月ミニカレンダーのドット用: 指定期間（グリッドの開始〜終了、終了は排他的）に予定が
// 1件以上ある日の集合（'YYYY-MM-DD'）を返す。7日リストとは別クエリだが取得経路は共通。
// 複数日・終日にまたがる予定は、またぐ各日にドットが付くよう start〜end（含む）を全て入れる。
export async function fetchEventDaysInRange(
  calendars: CalendarListEntry[],
  gridStartStr: string,
  gridEndExclusiveStr: string,
): Promise<Set<string>> {
  const timeMin = new Date(`${gridStartStr}T00:00:00`).toISOString()
  const timeMax = new Date(`${gridEndExclusiveStr}T00:00:00`).toISOString()
  const selected = calendars.filter((c) => c.selected !== false)
  const settled = await mapPool(selected, CAL_FETCH_CONCURRENCY, (cal) =>
    fetchEventsForCalendar(cal, timeMin, timeMax),
  )
  throwIfAllRejected(settled)
  const days = new Set<string>()
  for (const ev of fulfilledValues(settled).flat()) {
    let d = ev.startDateStr
    // start から end（含む）まで1日ずつ。guard は暴走防止（同一予定が400日を超えることは無い想定）。
    for (let guard = 0; guard < 400; guard++) {
      days.add(d)
      if (d >= ev.endDateStr) break
      d = addDaysToDateStr(d, 1)
    }
  }
  return days
}

// --- 書き込み系 ---

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// 予定作成・編集フォームが受け渡す下書き（ローカル表記）。
export interface EventDraft {
  calendarId: string
  title: string
  location: string
  description: string
  allDay: boolean
  startDate: string // 'YYYY-MM-DD'
  endDate: string // 'YYYY-MM-DD'（終日は「含む最終日」。API へは排他的に+1して送る）
  startTime: string // 'HH:mm'（終日のときは無視）
  endTime: string // 'HH:mm'（終日のときは無視）
}

// 既存の予定(CalendarEvent)を編集用の下書き(EventDraft)へ変換する。
// 変更したい項目だけ差し替える土台として使う（タイムラインのドラッグ移動/リサイズ・#17 Phase B）。
// 時刻が無い（終日）予定は既定の 09:00-10:00 を補う（時刻編集時のプレースホルダ）。
export function eventToDraft(ev: CalendarEvent): EventDraft {
  return {
    calendarId: ev.calendarId,
    title: ev.title,
    location: ev.location,
    description: ev.description,
    allDay: ev.allDay,
    startDate: ev.startDateStr,
    endDate: ev.endDateStr,
    startTime: ev.startTimeStr ?? '09:00',
    endTime: ev.endTimeStr ?? '10:00',
  }
}

type EventTimePoint = { date?: string | null; dateTime?: string | null; timeZone?: string | null }

// 下書きを events.insert/patch のボディ（start/end）に変換する。
// forPatch=true のときは、使わない側のフィールドを明示的に null で送る。
// patch はマージセマンティクス（送ったキーだけ上書き）なので、終日⇔時刻ありの切替時に
// null を送らないと date と dateTime が両方残ってエラーになる（Fable 助言の罠）。
function draftToBody(
  draft: EventDraft,
  forPatch: boolean,
): {
  summary: string
  location: string
  description: string
  start: EventTimePoint
  end: EventTimePoint
} {
  // 場所・詳細は常に送る（空文字を送れば patch で消去できる）。
  const common = { summary: draft.title, location: draft.location, description: draft.description }
  if (draft.allDay) {
    const start: EventTimePoint = { date: draft.startDate }
    // 終日 end.date は排他的（翌日）。含む最終日 + 1日。
    const end: EventTimePoint = { date: addDaysToDateStr(draft.endDate, 1) }
    if (forPatch) {
      start.dateTime = null
      start.timeZone = null
      end.dateTime = null
      end.timeZone = null
    }
    return { ...common, start, end }
  }
  const timeZone = getTimeZone()
  // オフセット無しのローカル日時 + timeZone で送る（端末TZで確定）。秒(:00)を必ず補う。
  const start: EventTimePoint = { dateTime: `${draft.startDate}T${draft.startTime}:00`, timeZone }
  const end: EventTimePoint = { dateTime: `${draft.endDate}T${draft.endTime}:00`, timeZone }
  if (forPatch) {
    start.date = null
    end.date = null
  }
  return { ...common, start, end }
}

// 楽観的更新用に、下書きから画面表示用の CalendarEvent を組み立てる（サーバー往復なし）。
export function draftToLocalEvent(
  draft: EventDraft,
  id: string,
  calendarName: string,
  calendarColor: string,
  opts?: { pending?: boolean; isRecurringInstance?: boolean; writable?: boolean },
): CalendarEvent {
  const allDay = draft.allDay
  const start = allDay ? null : new Date(`${draft.startDate}T${draft.startTime}:00`)
  const startMs = allDay
    ? new Date(`${draft.startDate}T00:00:00`).getTime()
    : (start as Date).getTime()
  return {
    id,
    title: draft.title,
    calendarId: draft.calendarId,
    calendarName,
    calendarColor,
    location: draft.location,
    description: draft.description,
    allDay,
    startMs,
    start,
    startDateStr: draft.startDate,
    endDateStr: draft.endDate,
    startTimeStr: allDay ? null : draft.startTime,
    endTimeStr: allDay ? null : draft.endTime,
    isRecurringInstance: opts?.isRecurringInstance ?? false,
    writable: opts?.writable ?? true,
    pending: opts?.pending,
  }
}

// startMs が「今日0時〜UPCOMING_DAYS 日後」の一覧ウィンドウ内かどうか（作成後に一覧へ出るかの判定）。
export function isWithinUpcomingWindow(startMs: number): boolean {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const end = startOfToday + UPCOMING_DAYS * 24 * 60 * 60 * 1000
  return startMs >= startOfToday && startMs < end
}

function eventUrl(calendarId: string, eventId: string): string {
  return `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
}

// 予定を作成する。作成された予定のIDを返す。
export async function createEvent(draft: EventDraft): Promise<{ id: string }> {
  const created = await fetchJson<{ id: string }>(
    `${CAL_BASE}/calendars/${encodeURIComponent(draft.calendarId)}/events`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(draftToBody(draft, false)) },
  )
  return { id: created.id }
}

// 予定を編集する（patch セマンティクス。start/end は指定した側で丸ごと置き換わるので
// timed↔終日の切替も安全）。繰り返し予定の場合、eventId が「この回」のインスタンスIDなら
// その回だけが変更される。
export async function updateEvent(
  calendarId: string,
  eventId: string,
  draft: EventDraft,
): Promise<void> {
  await fetchJson(eventUrl(calendarId, eventId), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(draftToBody(draft, true)),
  })
}

// 予定を削除する。繰り返し予定のインスタンスIDに対しては「その回だけ」削除になる。
// 既に削除済み（404 Not Found / 410 Gone）は成功扱いにして冪等化する。
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await fetchJson(eventUrl(calendarId, eventId), { method: 'DELETE' })
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return
    throw e
  }
}

// --- 繰り返しルール（RRULE）の取得・更新（#3） ---

// 繰り返しマスター予定の recurrence 配列（['RRULE:FREQ=WEEKLY;...'] 等）を取得する。
// 対象は「この回」のインスタンスIDではなく、親（マスター）のIDであること。
export async function fetchEventRecurrence(
  calendarId: string,
  masterEventId: string,
): Promise<string[]> {
  const ev = await fetchJson<{ recurrence?: string[] }>(eventUrl(calendarId, masterEventId))
  return ev.recurrence ?? []
}

// 繰り返しマスター予定の RRULE（繰り返しルール）だけを差し替える（シリーズ全体に適用）。
// recurrence 配列には RRULE 以外に EXDATE（除外日）/RDATE（追加日）が含まれることがあるため、
// それらは温存し、RRULE 行だけを新しいものに置き換える（丸ごと差し替えると除外日が消え、
// 消していた回が復活してしまう）。recurrence キーだけ patch するので他項目は変わらない。
export async function updateEventRecurrence(
  calendarId: string,
  masterEventId: string,
  rruleLines: string[],
): Promise<void> {
  const current = await fetchEventRecurrence(calendarId, masterEventId)
  const preserved = current.filter((line) => !line.toUpperCase().startsWith('RRULE'))
  await fetchJson(eventUrl(calendarId, masterEventId), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ recurrence: [...rruleLines, ...preserved] }),
  })
}

// 削除した予定を復元する（Undo）。Calendar の削除はソフトデリート（status が cancelled に
// なるだけ）なので、同じ event id に status:"confirmed" を PATCH すれば ID を保ったまま戻せる。
// 単発・繰り返しインスタンスのどちらにも同じ方法が効く（Fable 助言）。
export async function restoreEvent(calendarId: string, eventId: string): Promise<void> {
  await fetchJson(eventUrl(calendarId, eventId), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ status: 'confirmed' }),
  })
}

// 共有カレンダー一覧から、予定を作成できるカレンダー（owner/writer）だけを取り出す。
// 追加取得はせず、useCalendarList の select で使う純関数（#32）。既定の作成先は primary。
export function toWritableCalendars(entries: CalendarListEntry[]): WritableCalendar[] {
  return (
    entries
      .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
      .map((c) => ({
        id: c.id,
        name: c.summary,
        color: c.backgroundColor ?? '#5484ed',
        primary: Boolean(c.primary),
      }))
      // primary を先頭に
      .sort((a, b) => Number(b.primary) - Number(a.primary))
  )
}

// 共有カレンダー一覧から、ログイン中アカウントのメールアドレスを取り出す。
// primary（主）カレンダーの id がメールアドレスそのものなので、追加スコープ無しで判明する（#32）。
export function primaryEmail(entries: CalendarListEntry[]): string {
  return entries.find((c) => c.primary)?.id ?? ''
}
