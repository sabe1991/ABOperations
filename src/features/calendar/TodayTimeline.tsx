// 今日の24時間タイムライン（密度型レイアウトの1列目）。
// 既存の7日取得（useCalendarEvents）を再利用し、今日ぶんだけを時間軸に配置する。
// 活動時間帯（既定 7:00〜23:00）に絞り、範囲外に予定があればその時間まで自動で広げる。
// 現在時刻に赤い横線、終日予定は上部のチップ。読み取り専用（クリック編集は TODO #18）。
import { useEffect, useRef } from 'react'
import { useCalendarEvents } from './useCalendarEvents'
import type { CalendarEvent } from './api'

const HOUR_PX = 48 // 1時間あたりの高さ(px)
const GUTTER = 40 // 左の時刻ラベル幅(px)

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function timeToMin(hhmm: string | null): number {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// 時間帯の重なりを列（lane）に割り付ける。重なり合う塊（cluster）ごとに列数を数え、
// 各予定に { lane, lanes } を付けて横並び表示できるようにする。
interface Placed {
  ev: CalendarEvent
  startMin: number
  endMin: number
  lane: number
  lanes: number
}
function layout(timed: { ev: CalendarEvent; startMin: number; endMin: number }[]): Placed[] {
  const sorted = [...timed].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const result: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -1
  let laneEnds: number[] = []
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1))
    for (const c of cluster) result.push({ ...c, lanes })
    cluster = []
    laneEnds = []
    clusterEnd = -1
  }
  for (const t of sorted) {
    // 現在の塊と重ならない（＝塊の最大終了以降に始まる）なら塊を確定して新しい塊へ。
    if (cluster.length && t.startMin >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= t.startMin)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(t.endMin)
    } else {
      laneEnds[lane] = t.endMin
    }
    cluster.push({ ev: t.ev, startMin: t.startMin, endMin: t.endMin, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, t.endMin)
  }
  if (cluster.length) flush()
  return result
}

export function TodayTimeline() {
  const { data: events, isLoading, isError } = useCalendarEvents()
  const nowRef = useRef<HTMLDivElement | null>(null)
  const scrolledRef = useRef(false)

  const now = new Date()
  const todayStr = fmtDate(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  // 今日にかかる予定だけ抽出（終日/時刻ありとも start〜end が今日を含むもの）。
  const todays = (events ?? []).filter(
    (ev) => ev.startDateStr <= todayStr && todayStr <= ev.endDateStr,
  )
  const allDay = todays.filter((ev) => ev.allDay)
  const timed = todays
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      // 前日から続く予定は 0:00、翌日へ続く予定は 24:00 にクランプする。
      const startMin = ev.startDateStr === todayStr ? timeToMin(ev.startTimeStr) : 0
      let endMin = ev.endDateStr === todayStr ? timeToMin(ev.endTimeStr) : 24 * 60
      if (endMin <= startMin) endMin = startMin + 30 // 0分予定に最低高さ
      return { ev, startMin, endMin }
    })

  // 終日 0:00〜24:00 を描画し、パネル内スクロールで早朝・深夜にもアクセスできる（ユーザー要望）。
  // 既定は現在時刻付近を表示する（下の useEffect で現在時刻の位置へスクロール）。
  const winStart = 0
  const winEnd = 24 * 60

  const placed = layout(timed)
  const axisHeight = ((winEnd - winStart) / 60) * HOUR_PX
  const hours: number[] = []
  for (let h = winStart / 60; h <= winEnd / 60; h++) hours.push(h)
  const nowVisible = nowMin >= winStart && nowMin <= winEnd

  // 初回に現在時刻が見える位置へスクロール（パネル内スクローラーを動かす）。
  useEffect(() => {
    if (scrolledRef.current || !events) return
    if (nowRef.current) {
      nowRef.current.scrollIntoView({ block: 'center' })
      scrolledRef.current = true
    }
  }, [events])

  if (isError) return <p className="panel__note panel__note--error">今日の予定の取得に失敗しました。</p>
  if (isLoading && !events) return <p className="panel__note">読み込み中…</p>
  if (todays.length === 0) return <p className="panel__note">今日の予定はありません。</p>

  return (
    <div className="timeline">
      {allDay.length > 0 && (
        <div className="timeline__allday">
          {allDay.map((ev) => (
            <span
              key={ev.id}
              className="timeline__chip"
              style={{ borderColor: ev.calendarColor }}
              title={ev.title}
            >
              {ev.title}
            </span>
          ))}
        </div>
      )}
      <div className="timeline__axis" style={{ height: axisHeight }}>
        {hours.map((h) => {
          const top = ((h * 60 - winStart) / 60) * HOUR_PX
          return (
            <div key={h} className="timeline__hour" style={{ top }}>
              <span className="timeline__hour-label">{String(h).padStart(2, '0')}:00</span>
            </div>
          )
        })}
        {placed.map((p) => {
          const top = ((p.startMin - winStart) / 60) * HOUR_PX
          const height = Math.max(18, ((p.endMin - p.startMin) / 60) * HOUR_PX - 1)
          const left = `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${p.lane} / ${p.lanes})`
          const width = `calc((100% - ${GUTTER}px) / ${p.lanes} - 2px)`
          return (
            <div
              key={p.ev.id}
              className="timeline__event"
              style={{ top, height, left, width, borderColor: p.ev.calendarColor }}
              title={`${p.ev.startTimeStr ?? ''} ${p.ev.title}`}
            >
              <span className="timeline__event-time">{p.ev.startTimeStr}</span>
              <span className="timeline__event-title">{p.ev.title}</span>
            </div>
          )
        })}
        {nowVisible && (
          <div
            ref={nowRef}
            className="timeline__now"
            style={{ top: ((nowMin - winStart) / 60) * HOUR_PX }}
            aria-label="現在時刻"
          />
        )}
      </div>
    </div>
  )
}
