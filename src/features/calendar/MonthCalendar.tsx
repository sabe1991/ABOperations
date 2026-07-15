// ミニカレンダー（密度型レイアウトの2列目・上段の右）。
// 「今月」ではなく「今週から5週間」を表示する（過去の月・過去週は予定パネルへスクロールできず
// 出す意味が薄いため・ユーザー要望）。グリッドの左上は今週の開始曜日、そこから5週=35セル。
// 今週の中で今日より前の日は薄く・クリック不可にする。今日以降はクリックで予定パネルをその日へ。
// 予定のある日には小さなドットを付ける（読み取り専用）。
import { useRef, useState } from 'react'
import { useMonthEventDays } from './useCalendarEvents'
import { useWeekStart } from '../settings/displayPrefs'
import { requestScrollToDate } from './scrollTarget'
import { setSelectedDate, useSelectedDate } from './selectedDate'

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
  // タイムラインに表示中の選択日（未選択=null は「今日」扱い）。選択中セルの強調に使う。
  const selectedStr = useSelectedDate() ?? todayStr

  // 今週の開始日（週開始設定ぶんだけ今日から戻した日）を左上にし、5週=35セル作る。
  // new Date(year, month, x) は x が月の範囲外でも自動で前後の月へ繰り上げ/繰り下げされる。
  const daysFromWeekStart = (now.getDay() - weekStart + 7) % 7
  const gridStartDay = date - daysFromWeekStart
  const cells: Date[] = []
  for (let i = 0; i < 35; i++) cells.push(new Date(year, month, gridStartDay + i))
  const gridStartStr = fmt(cells[0])
  const gridEndExclusiveStr = fmt(new Date(year, month, gridStartDay + 35))

  const { data: eventDays, isLoading, isError } = useMonthEventDays(gridStartStr, gridEndExclusiveStr)

  // 表示範囲（M/D 〜 M/D）。画面には出さず、スクリーンリーダー用の aria-label にだけ使う。
  // 月は各セル（先頭セル・月初セル）の「M/D」表記で分かるようにしたため、範囲キャプションは省く。
  const first = cells[0]
  const last = cells[34]
  const rangeLabel = `${first.getMonth() + 1}/${first.getDate()} 〜 ${last.getMonth() + 1}/${last.getDate()}`

  // 5週×7日を週ごとの行に分割する（グリッドの ARIA 行構造のため）。
  const weeks: Date[][] = Array.from({ length: 5 }, (_, w) => cells.slice(w * 7, w * 7 + 7))

  // --- 矢印キーでの日移動（WAI-ARIA グリッドパターン・ロービングタブインデックス） ---
  // 過去日（今日より前）はクリックできない＝フォーカス対象外。今日の位置は週内オフセットに一致する。
  const todayIdx = daysFromWeekStart
  const isPastIdx = (i: number): boolean => fmt(cells[i]) < todayStr
  const isFocusableIdx = (i: number): boolean => i >= 0 && i <= 34 && !isPastIdx(i)
  // Tab でカレンダーに入ったとき最初に focus されるセル（＝ロービングの起点）。
  // 既定は選択日。選択日がグリッド外/過去なら今日へ寄せる。
  const selectedIdx = cells.findIndex((d) => fmt(d) === selectedStr)
  const defaultIdx = isFocusableIdx(selectedIdx) ? selectedIdx : todayIdx
  // 矢印キーで動かした現在のフォーカス位置。未操作(null)の間は defaultIdx を使う。
  const [focusIdx, setFocusIdx] = useState<number | null>(null)
  const tabbableIdx = focusIdx != null && isFocusableIdx(focusIdx) ? focusIdx : defaultIdx
  const gridRef = useRef<HTMLDivElement>(null)
  // 「今後の予定」リストへスクロールしたい日を一時保持する。キー長押し中はスクロールを溜めておき、
  // キーを離した時（keyup）に最後の1回だけ実行する（下記 handleGridKeyUp）。
  const pendingScrollRef = useRef<string | null>(null)

  // 指定 index のセル（フォーカス可能なボタン）に DOM フォーカスを移す。
  function focusCell(i: number): void {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${i}"]`)?.focus()
  }
  // 行 [start, end] の中で最初/最後のフォーカス可能セルを探す（Home/End 用）。
  function firstFocusableInRow(start: number, end: number): number | null {
    for (let i = start; i <= end; i++) if (isFocusableIdx(i)) return i
    return null
  }
  function lastFocusableInRow(start: number, end: number): number | null {
    for (let i = end; i >= start; i--) if (isFocusableIdx(i)) return i
    return null
  }

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const cur = tabbableIdx
    let target: number | null = null
    switch (e.key) {
      case 'ArrowRight':
        target = cur + 1
        break
      case 'ArrowLeft':
        target = cur - 1
        break
      case 'ArrowDown':
        target = cur + 7
        break
      case 'ArrowUp':
        target = cur - 7
        break
      case 'Home': {
        const rowStart = Math.floor(cur / 7) * 7
        target = firstFocusableInRow(rowStart, rowStart + 6)
        break
      }
      case 'End': {
        const rowStart = Math.floor(cur / 7) * 7
        target = lastFocusableInRow(rowStart, rowStart + 6)
        break
      }
      default:
        return
    }
    // 過去日・範囲外へは移動しない（選択できないため）。移動の有無に関わらず既定スクロールは抑止。
    e.preventDefault()
    if (target == null || !isFocusableIdx(target)) return
    setFocusIdx(target)
    focusCell(target)
    // 矢印キーでも表示日（タイムラインの対象日）を即時に切り替え、
    // さらに「今後の予定」リストもその日の見出しへスクロールして連動させる（ユーザー要望）。
    // その日に予定が無いときは見出しが無いのでスクロールは起きない（＝画面は動かない）。
    const targetStr = fmt(cells[target])
    setSelectedDate(targetStr)
    // スクロールしたい日を控えておき、実行は原則 keyup（キーを離した時）に1回だけ行う。
    // キー長押しのリピート（e.repeat=true）中に毎回 smooth スクロールすると、アニメーションが
    // 毎回やり直しになってリストが震えながら進まなくなるため（Fable 指摘）。
    // 単押し（リピートでない最初の押下）は即スクロールして即応性を保つ。
    pendingScrollRef.current = targetStr
    if (!e.repeat) requestScrollToDate(targetStr)
  }

  // キーを離したら、控えていた最終位置へ1回だけスクロールする（長押しで一気に移動したときの着地）。
  function handleGridKeyUp(e: React.KeyboardEvent<HTMLDivElement>): void {
    const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!NAV_KEYS.includes(e.key)) return
    if (pendingScrollRef.current) requestScrollToDate(pendingScrollRef.current)
  }

  return (
    <div className="month">
      {/* role="grid" は行(role="row")→セル(role="gridcell"/columnheader) の入れ子を要求するが、
          CSS はフラットな7列グリッドで組んでいる。行・セルのラッパーには display:contents を当て、
          レイアウトを崩さずに ARIA の行構造だけを与える（.month__row / .month__gridcell）。
          データ取得中は aria-busy を立てる（日付マスは即表示され、予定ドットだけ後から入る・#39）。 */}
      <div
        className="month__grid"
        role="grid"
        aria-label={`${rangeLabel} のカレンダー`}
        aria-busy={isLoading || undefined}
        ref={gridRef}
        onKeyDown={handleGridKeyDown}
        onKeyUp={handleGridKeyUp}
      >
        <div className="month__row" role="row">
          {Array.from({ length: 7 }, (_, i) => {
            // 列 i が表す実際の曜日番号。週開始が月曜(1)なら列0=月, 列6=日 になる。
            const dow = (weekStart + i) % 7
            return (
              <div
                key={dow}
                role="columnheader"
                className={`month__dow${dow === 0 ? ' month__dow--sun' : ''}${dow === 6 ? ' month__dow--sat' : ''}`}
              >
                {WEEKDAYS[dow]}
              </div>
            )
          })}
        </div>
        {weeks.map((week, w) => (
          <div className="month__row" role="row" key={w}>
            {week.map((d, j) => {
              const idx = w * 7 + j
              const ds = fmt(d)
              const isToday = ds === todayStr
              const isPast = ds < todayStr
              const has = eventDays?.has(ds) ?? false
              const dow = d.getDay()
              // 先頭セル（表示の最初の日付）は、範囲キャプションを消した代わりに月が分かるよう「M/D」表記にする。
              // 月初(1日)も月をまたいだ目印として「M/1」表記にする（今日は塗るので数字のみ）。
              const showMonth = idx === 0 || (d.getDate() === 1 && !isToday)
              const numText = showMonth ? `${d.getMonth() + 1}/${d.getDate()}` : String(d.getDate())
              const isSelected = ds === selectedStr
              const cls = [
                'month__cell',
                isToday ? 'month__cell--today' : '',
                isSelected ? 'month__cell--selected' : '',
                isPast ? 'month__cell--past' : '',
                dow === 0 ? 'month__cell--sun' : '',
                dow === 6 ? 'month__cell--sat' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div className="month__gridcell" role="gridcell" key={ds}>
                  {isPast ? (
                    // 過去日はクリックできない（予定パネルは今日以降しか出さない）。div で描画。
                    <div className={cls}>
                      <span className="month__num">{numText}</span>
                      {has && <span className="month__dot" aria-label="予定あり" />}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={cls}
                      // 矢印キーで移動する範囲（#40）。選択中セルだけ Tab 順に入れ、他は矢印キーで辿る。
                      data-idx={idx}
                      tabIndex={idx === tabbableIdx ? 0 : -1}
                      // クリックでタイムラインの表示日を切り替え、予定リストもその日へスクロールする。
                      onClick={() => {
                        setFocusIdx(idx)
                        setSelectedDate(ds)
                        requestScrollToDate(ds)
                      }}
                      title={`${d.getMonth() + 1}月${d.getDate()}日の予定を表示`}
                    >
                      <span className="month__num">{numText}</span>
                      {has && <span className="month__dot" aria-label="予定あり" />}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {isError && <p className="panel__note panel__note--error">予定の取得に失敗しました。</p>}
    </div>
  )
}
