// 月ミニカレンダー（密度型レイアウトの2列目・上段の右）。
// 今月を日曜始まり6週のグリッドで表示し、今日を強調・予定のある日に小さなドットを付ける。
// 読み取り専用（v1 ではクリック遷移なし）。データは 7日リストとは別の月クエリから読む。
import { useMonthEventDays } from './useCalendarEvents'
import { useWeekStart } from '../settings/displayPrefs'
import { requestScrollToDate } from './scrollTarget'

// 実際の曜日番号（0=日〜6=土）で引くラベル。週の開始曜日に関わらずこの並びで参照する。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// Date → ローカルの 'YYYY-MM-DD'（toISOString を使わず TZ ズレを回避）。
function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function MonthCalendar() {
  const weekStart = useWeekStart() // 0=日曜始まり, 1=月曜始まり
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0始まり
  const todayStr = fmt(now)

  // 今月1日を、週の開始曜日ぶんだけ前へ戻したところをグリッドの左上にし、6週=42セル作る。
  // offset = 「1日の曜日」から「週開始曜日」までの距離。new Date(year, month, x) は x が
  // 月の範囲外でも自動で前後の月に繰り上げ/繰り下げされる。
  const firstDow = new Date(year, month, 1).getDay() // 0=日
  const offset = (firstDow - weekStart + 7) % 7
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) cells.push(new Date(year, month, 1 - offset + i))
  const gridStartStr = fmt(cells[0])
  const gridEndExclusiveStr = fmt(new Date(year, month, 1 - offset + 42))

  const { data: eventDays, isLoading, isError } = useMonthEventDays(gridStartStr, gridEndExclusiveStr)

  return (
    <div className="month">
      <div className="month__caption">
        {year}年{month + 1}月
      </div>
      <div className="month__grid" role="grid" aria-label={`${year}年${month + 1}月`}>
        {Array.from({ length: 7 }, (_, i) => {
          // 列 i が表す実際の曜日番号。週開始が月曜(1)なら列0=月, 列6=日 になる。
          const dow = (weekStart + i) % 7
          return (
            <div
              key={dow}
              className={`month__dow${dow === 0 ? ' month__dow--sun' : ''}${dow === 6 ? ' month__dow--sat' : ''}`}
            >
              {WEEKDAYS[dow]}
            </div>
          )
        })}
        {cells.map((d) => {
          const ds = fmt(d)
          const inMonth = d.getMonth() === month
          const isToday = ds === todayStr
          const has = eventDays?.has(ds) ?? false
          const dow = d.getDay()
          const cls = [
            'month__cell',
            inMonth ? '' : 'month__cell--out',
            isToday ? 'month__cell--today' : '',
            dow === 0 ? 'month__cell--sun' : '',
            dow === 6 ? 'month__cell--sat' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={ds}
              type="button"
              className={cls}
              onClick={() => requestScrollToDate(ds)}
              title={`${d.getMonth() + 1}月${d.getDate()}日の予定へ`}
            >
              <span className="month__num">{d.getDate()}</span>
              {has && <span className="month__dot" aria-label="予定あり" />}
            </button>
          )
        })}
      </div>
      {isError && <p className="panel__note panel__note--error">今月の予定の取得に失敗しました。</p>}
      {isLoading && !eventDays && <p className="panel__note">読み込み中…</p>}
    </div>
  )
}
