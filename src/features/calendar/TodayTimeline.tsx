// 今日の24時間タイムライン（密度型レイアウトの1列目）。
// 既存の7日取得（useCalendarEvents）を再利用し、今日ぶんだけを時間軸に配置する。
// 0:00〜24:00 を描画し、初回は現在時刻が画面の少し上に来る位置へスクロールする。
// 現在時刻に赤い横線、終日予定は上部のチップ。
// 操作: 予定クリックで編集シートを開く（#18）、空き時間のドラッグで作成シートを開く（#17 Phase A）。
// どちらも CalendarPanel の既存シート／ミューテーションへシグナル（calendarSheetSignal）で委譲する。
import { useEffect, useRef, useState } from 'react'
import { useCalendarEvents } from './useCalendarEvents'
import { requestCreateEventAt, requestEditEvent } from './calendarSheetSignal'
import type { CalendarEvent } from './api'
import { TimelineSkeleton } from '../../Skeleton'

const HOUR_PX = 48 // 1時間あたりの高さ(px)
const GUTTER = 40 // 左の時刻ラベル幅(px)
const SNAP_MIN = 15 // ドラッグ作成の時刻スナップ幅(分)

// 分(0〜1440)を 'HH:mm' に整形する。type=time / EventDraft がそのまま受け取れる値にする。
function minToHHmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

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

// 要素の「スクロールする祖先」（overflow-y が auto/scroll で実際にスクロール可能な親）を探す。
function getScrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
    p = p.parentElement
  }
  return null
}

export function TodayTimeline() {
  const { data: events, isLoading, isError } = useCalendarEvents()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const axisRef = useRef<HTMLDivElement | null>(null)
  const nowRef = useRef<HTMLDivElement | null>(null)
  const scrolledRef = useRef(false)
  // 空き時間ドラッグ（#17 Phase A）の途中経過。startMin=押した位置, curMin=現在位置（ともに分・15分スナップ済み）。
  const [drag, setDrag] = useState<{ startMin: number; curMin: number } | null>(null)
  // クリック（微小移動）と本当のドラッグを弁別するための押下位置の生の clientY。
  const dragStartYRef = useRef<number | null>(null)

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

  // 0:00〜24:00 を描画し、パネル内スクロールで早朝・深夜にもアクセスできる（ユーザー要望）。
  // 初回スクロール位置は下の useEffect で現在時刻基準に合わせる（#29）。
  const winStart = 0
  const winEnd = 24 * 60

  const placed = layout(timed)
  const axisHeight = ((winEnd - winStart) / 60) * HOUR_PX
  const hours: number[] = []
  for (let h = winStart / 60; h <= winEnd / 60; h++) hours.push(h)
  const nowVisible = nowMin >= winStart && nowMin <= winEnd

  // 初回スクロール（#29）: 現在時刻の赤線が可視域の上から約4割の位置に来るように合わせる。
  // 「朝イチで今日の予定を見る」用途なので、最下部（夜）ではなく現在時刻を中心やや上に置く。
  // events の refetch のたびに再実行されるので scrolledRef で初回だけに限定する
  // （ガードが無いと5分ポーリングごとにスクロール位置を奪ってしまう）。
  useEffect(() => {
    if (scrolledRef.current || !events) return
    const root = rootRef.current
    if (!root) return
    const scroller = getScrollParent(root)
    if (!scroller) return
    const nowEl = nowRef.current
    if (nowEl) {
      // rect 差分で算出（allday チップ行の高さ可変によるオフセットずれを避ける）。
      const nowRect = nowEl.getBoundingClientRect()
      const scRect = scroller.getBoundingClientRect()
      const target = nowRect.top - scRect.top + scroller.scrollTop - scroller.clientHeight * 0.4
      scroller.scrollTop = Math.max(0, target) // ブラウザが上限もクランプする
    } else {
      scroller.scrollTop = scroller.scrollHeight
    }
    scrolledRef.current = true
  }, [events])

  // --- 空き時間ドラッグで作成シートを開く（#17 Phase A） ---
  // ポインタ位置(clientY)を軸上の分(0〜1440, 15分スナップ)に変換する。
  // getBoundingClientRect はスクロール済みの表示位置を返すので、追加のスクロール補正は不要。
  function yToSnappedMin(clientY: number): number {
    const axis = axisRef.current
    if (!axis) return 0
    const rect = axis.getBoundingClientRect()
    const raw = ((clientY - rect.top) / HOUR_PX) * 60
    const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN
    return Math.max(0, Math.min(24 * 60, snapped))
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 予定の上で始まったらドラッグ作成はしない（予定クリック＝編集に譲る）。
    if ((e.target as HTMLElement).closest('.timeline__event')) return
    // タッチはパネルの縦スクロールを優先（マウス/ペンのみでドラッグ作成する）。
    if (e.pointerType === 'touch' || e.button !== 0) return
    // 左端の時刻ラベル帯（ガター）上では作成を始めない。
    const rect = axisRef.current?.getBoundingClientRect()
    if (rect && e.clientX < rect.left + GUTTER) return
    dragStartYRef.current = e.clientY
    const min = yToSnappedMin(e.clientY)
    setDrag({ startMin: min, curMin: min })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const cur = yToSnappedMin(e.clientY)
    if (cur === drag.curMin) return // スナップ値が変わらなければ再描画しない
    setDrag({ startMin: drag.startMin, curMin: cur })
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const startY = dragStartYRef.current
    dragStartYRef.current = null
    const rawMoved = startY == null ? 0 : Math.abs(e.clientY - startY)
    setDrag(null)
    // 生のピクセル移動が小さい（＝クリック相当）なら作成しない。スナップ後の分で
    // 判定すると 7.5分境界付近の手ぶれ数pxでも誤って作成シートが開くため、生の px で見る。
    if (rawMoved < 6) return
    // 開始・終了を「その日の中に収まる有効な HH:mm」に正規化する。
    // 開始は最大 23:30、終了は開始+15分〜23:45（24:00 は type=time に入らないため避ける）。
    const lo = Math.min(drag.startMin, drag.curMin)
    const hi = Math.max(drag.startMin, drag.curMin)
    const startMin = Math.min(lo, 23 * 60 + 30)
    const endMin = Math.min(Math.max(hi, startMin + SNAP_MIN), 23 * 60 + 45)
    requestCreateEventAt(todayStr, minToHHmm(startMin), minToHHmm(endMin))
  }

  if (isError) return <p className="panel__note panel__note--error">今日の予定の取得に失敗しました。</p>
  if (isLoading && !events) return <TimelineSkeleton />
  // 今日の予定が0件でも軸は描画する（空き時間ドラッグ作成・初期スクロールを使えるようにするため）。

  return (
    <div className="timeline" ref={rootRef}>
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
      <div
        className="timeline__axis"
        ref={axisRef}
        style={{ height: axisHeight }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
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
          // 書き込み可能で確定済み（pending でない）予定だけ、クリックで編集シートを開ける（#18）。
          const editable = p.ev.writable && !p.ev.pending
          return (
            <div
              key={p.ev.id}
              className={`timeline__event${editable ? ' timeline__event--editable' : ''}`}
              style={{ top, height, left, width, borderColor: p.ev.calendarColor }}
              title={`${p.ev.startTimeStr ?? ''} ${p.ev.title}`}
              onClick={editable ? () => requestEditEvent(p.ev) : undefined}
              role={editable ? 'button' : undefined}
              tabIndex={editable ? 0 : undefined}
              onKeyDown={
                editable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        requestEditEvent(p.ev)
                      }
                    }
                  : undefined
              }
            >
              <span className="timeline__event-time">{p.ev.startTimeStr}</span>
              <span className="timeline__event-title">{p.ev.title}</span>
            </div>
          )
        })}
        {drag && (
          <div
            className="timeline__drag-sel"
            style={{
              top: (Math.min(drag.startMin, drag.curMin) / 60) * HOUR_PX,
              height: Math.max(2, (Math.abs(drag.curMin - drag.startMin) / 60) * HOUR_PX),
              left: GUTTER,
            }}
            aria-hidden
          />
        )}
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
