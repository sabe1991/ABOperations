// ミニカレンダー（密度型レイアウトの2列目・上段の右）。
// 「今月」ではなく「今週から5週間」を表示する（過去の月・過去週は予定パネルへスクロールできず
// 出す意味が薄いため・ユーザー要望）。グリッドの左上は今週の開始曜日、そこから5週=35セル。
// 今週の中で今日より前の日は薄く・クリック不可にする。今日以降はクリックで予定パネルをその日へ。
// 予定のある日には小さなドットを付ける（読み取り専用）。
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
  const month = now.getMonth()
  const date = now.getDate()
  const todayStr = fmt(now)

  // 今週の開始日（週開始設定ぶんだけ今日から戻した日）を左上にし、5週=35セル作る。
  // new Date(year, month, x) は x が月の範囲外でも自動で前後の月へ繰り上げ/繰り下げされる。
  const daysFromWeekStart = (now.getDay() - weekStart + 7) % 7
  const gridStartDay = date - daysFromWeekStart
  const cells: Date[] = []
  for (let i = 0; i < 35; i++) cells.push(new Date(year, month, gridStartDay + i))
  const gridStartStr = fmt(cells[0])
  const gridEndExclusiveStr = fmt(new Date(year, month, gridStartDay + 35))

  const { data: eventDays, isLoading, isError } = useMonthEventDays(gridStartStr, gridEndExclusiveStr)

  // キャプションは表示範囲（M/D 〜 M/D）。月をまたぐことがあるため範囲で示す。
  const first = cells[0]
  const last = cells[34]
  const caption = `${first.getMonth() + 1}/${first.getDate()} 〜 ${last.getMonth() + 1}/${last.getDate()}`

  return (
    <div className="month">
      <div className="month__caption">{caption}</div>
      <div className="month__grid" role="grid" aria-label={`${caption} のカレンダー`}>
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
          const isToday = ds === todayStr
          const isPast = ds < todayStr
          const has = eventDays?.has(ds) ?? false
          const dow = d.getDay()
          // 月初(1日)は月をまたいだ目印として「M/1」表記にする（今日は塗るので数字のみ）。
          const numText = d.getDate() === 1 && !isToday ? `${d.getMonth() + 1}/1` : String(d.getDate())
          const cls = [
            'month__cell',
            isToday ? 'month__cell--today' : '',
            isPast ? 'month__cell--past' : '',
            dow === 0 ? 'month__cell--sun' : '',
            dow === 6 ? 'month__cell--sat' : '',
          ]
            .filter(Boolean)
            .join(' ')

          // 過去日はクリックできない（予定パネルは今日以降しか出さない）。div で描画。
          if (isPast) {
            return (
              <div key={ds} className={cls}>
                <span className="month__num">{numText}</span>
                {has && <span className="month__dot" aria-label="予定あり" />}
              </div>
            )
          }
          return (
            <button
              key={ds}
              type="button"
              className={cls}
              onClick={() => requestScrollToDate(ds)}
              title={`${d.getMonth() + 1}月${d.getDate()}日の予定へ`}
            >
              <span className="month__num">{numText}</span>
              {has && <span className="month__dot" aria-label="予定あり" />}
            </button>
          )
        })}
      </div>
      {isError && <p className="panel__note panel__note--error">予定の取得に失敗しました。</p>}
      {isLoading && !eventDays && <p className="panel__note">読み込み中…</p>}
    </div>
  )
}
