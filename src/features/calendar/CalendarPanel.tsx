// カレンダーパネル（フェーズ2の素朴版）。
// 今日から7日分の予定を日付ごとにまとめて時系列表示する。
// 色分けはカレンダー色の小さな点だけに留め、詳細UI はフェーズ3以降。

import { useCalendarEvents } from './useCalendarEvents'
import type { CalendarEvent } from './api'

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

export function CalendarPanel() {
  const { data: events, isLoading, isError, error } = useCalendarEvents()

  if (isLoading) {
    return <p className="panel__note">予定を読み込み中…</p>
  }
  if (isError) {
    // 401（AuthError）はグローバルに再接続バナーで扱うため、ここでは一般エラーのみ表示
    return <p className="panel__note panel__note--error">予定の取得に失敗しました: {String(error)}</p>
  }
  if (!events || events.length === 0) {
    return <p className="panel__note">今後7日間は予定なし</p>
  }

  return (
    <div className="calendar">
      {groupByDay(events).map(([dayKey, dayEvents]) => (
        <section key={dayKey} className="calendar__day">
          <h3 className="calendar__day-header">{formatDayHeader(dayEvents[0])}</h3>
          <ul className="calendar__events">
            {dayEvents.map((ev) => (
              <li key={`${ev.calendarId}:${ev.id}`} className="calendar__event">
                <span className="calendar__time">{formatTime(ev)}</span>
                <span
                  className="calendar__dot"
                  style={{ backgroundColor: ev.calendarColor }}
                  aria-hidden
                />
                <span className="calendar__title">{ev.title}</span>
                <span className="calendar__cal-name">{ev.calendarName}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
