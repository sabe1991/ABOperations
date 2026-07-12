// Google Calendar API の呼び出し。
// フェーズ2の縦切りスコープ: 全カレンダーを取得し、今日から7日分の予定を時系列で返す。
// 色分け・詳細表示・厳密なタイムゾーン対応はフェーズ3以降（ここでは素朴な表示に留める）。

import { fetchJson } from '../../google/fetchJson'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

// --- API レスポンスの型（必要な項目だけ）---

interface CalendarListResponse {
  items?: CalendarListEntry[]
}

interface CalendarListEntry {
  id: string
  summary: string
  backgroundColor?: string
  // 非表示・非選択のカレンダーを除外する判定に使う
  selected?: boolean
}

interface EventsResponse {
  items?: GoogleEvent[]
}

interface GoogleEvent {
  id: string
  summary?: string
  status?: string
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
  // 終日予定かどうか
  allDay: boolean
  // 並べ替え用のソートキー（開始時刻の数値）。終日予定はその日の0時扱い。
  startMs: number
  // 表示用の開始時刻（終日予定は null）
  start: Date | null
}

// カレンダー一覧を取得する。
async function fetchCalendarList(): Promise<CalendarListEntry[]> {
  const res = await fetchJson<CalendarListResponse>(`${CAL_BASE}/users/me/calendarList`)
  return res.items ?? []
}

// 1つのカレンダーから、指定期間の予定を取得する。
// singleEvents=true で繰り返し予定を各回に展開して受け取る（PLAN の実装メモ参照）。
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
  const events: CalendarEvent[] = []
  for (const ev of res.items ?? []) {
    if (ev.status === 'cancelled') continue
    const allDay = Boolean(ev.start?.date)
    let startMs: number
    let start: Date | null
    if (allDay && ev.start?.date) {
      // 終日予定: 日付のみ。その日のローカル0時をソートキーにする。
      start = null
      startMs = new Date(`${ev.start.date}T00:00:00`).getTime()
    } else if (ev.start?.dateTime) {
      start = new Date(ev.start.dateTime)
      startMs = start.getTime()
    } else {
      continue
    }
    events.push({
      id: ev.id,
      title: ev.summary ?? '(タイトルなし)',
      calendarId: cal.id,
      calendarName: cal.summary,
      calendarColor: color,
      allDay,
      startMs,
      start,
    })
  }
  return events
}

// 今日から7日分の全カレンダーの予定を、開始時刻順にまとめて取得する。
export async function fetchUpcomingEvents(): Promise<CalendarEvent[]> {
  // 今日のローカル0時から7日後まで
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sevenDaysLater = new Date(startOfToday.getTime())
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)
  const timeMin = startOfToday.toISOString()
  const timeMax = sevenDaysLater.toISOString()

  const calendars = (await fetchCalendarList()).filter((c) => c.selected !== false)

  // カレンダーごとに並列取得（Tasks と違いカレンダーは並列で問題ない）
  const perCalendar = await Promise.all(
    calendars.map((cal) => fetchEventsForCalendar(cal, timeMin, timeMax)),
  )

  return perCalendar.flat().sort((a, b) => a.startMs - b.startMs)
}
