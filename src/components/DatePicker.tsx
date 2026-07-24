// 日付入力用の自前カレンダー（独自の日付ピッカー）。
// ブラウザ標準の <input type="date"> のポップアップは週の始まり（日曜/月曜）が
// OS/ブラウザのロケール依存で、HTML/CSS/JS からは変えられない。そこで標準ピッカーを
// やめてこの自前カレンダーに置き換え、アプリの「週の始まり」設定（useWeekStart）に従わせる。
// これによりダッシュボードの月ミニカレンダーと開始曜日が一致する（ユーザー要望）。
// min（下限日）を渡すと、その日より前は選べない（過去日の期限指定を防ぐ、など）。

import { useEffect, useRef, useState } from 'react'
import { useWeekStart } from '../features/settings/displayPrefs'

// 実際の曜日番号（0=日〜6=土）で引くラベル。週の開始曜日に関わらずこの並びで参照する。
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// 年・月(0基点)・日 → 'YYYY-MM-DD'
function toStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

// 端末ローカルの今日を 'YYYY-MM-DD' で。
function todayStr(): string {
  const d = new Date()
  return toStr(d.getFullYear(), d.getMonth(), d.getDate())
}

// 'YYYY-MM-DD' を年・月(0基点)・日へ分解（不正なら null）。
function parse(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

// トリガーボタンに出す表示（例「2026年7月25日 (金)」）。
function fmtDisplay(s: string): string {
  const p = parse(s)
  if (!p) return ''
  const wd = new Date(p.y, p.m, p.d).getDay()
  return `${p.y}年${p.m + 1}月${p.d}日 (${WEEKDAY_LABELS[wd]})`
}

interface Props {
  value: string
  onChange: (v: string) => void
  /** この日より前は選べない（'YYYY-MM-DD'）。省略時は下限なし。 */
  min?: string
  disabled?: boolean
  ariaLabel?: string
  /** トリガーボタンに付ける追加クラス。 */
  className?: string
}

export function DatePicker({ value, onChange, min, disabled, ariaLabel, className }: Props) {
  const weekStart = useWeekStart() // 0=日曜始まり, 1=月曜始まり
  const [open, setOpen] = useState(false)
  // カレンダーを上向きに出すか（下に十分な余白が無いとき。ボトムシート下部の日付欄対策）。
  const [openUp, setOpenUp] = useState(false)
  // 表示中の年月。開いたときに選択値（無ければ min か今日）の月へ合わせる。
  const base = parse(value) ?? parse(min ?? '') ?? parse(todayStr())!
  const [view, setView] = useState({ y: base.y, m: base.m })
  const rootRef = useRef<HTMLDivElement>(null)

  // 開いた瞬間に、(1)表示月を選択値（無ければ min/今日）の月へ寄せ、(2)下の余白が足りなければ上向きに出す。
  useEffect(() => {
    if (!open) return
    const p = parse(value) ?? parse(min ?? '') ?? parse(todayStr())
    if (p) setView({ y: p.y, m: p.m })
    const POPUP_H = 330 // カレンダーのおおよその高さ(px)
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom
      setOpenUp(below < POPUP_H && rect.top > below)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 外側クリック・Esc で閉じる。
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    // Esc はまずカレンダーだけ閉じる。ボトムシート/モーダル（useDialog）は document の
    // キャプチャで Esc を拾い stopPropagation で自分を閉じてしまうため、それより先に走らせる
    // 必要がある。キャプチャ段は window→document の順なので、window のキャプチャで先取りし、
    // stopPropagation で親の Esc（シートを閉じる）へ伝わらないようにする。
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // 表示中の曜日ヘッダ（週開始ぶんだけ回転させる）。
  const dowHeaders = Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(weekStart + i) % 7])

  // グリッド生成: 月初の前に空セル、そのあと日を並べ、7の倍数まで埋める。
  const firstRealDow = new Date(view.y, view.m, 1).getDay() // 0=日〜6=土
  const lead = (firstRealDow - weekStart + 7) % 7 // 週開始からのオフセット
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const today = todayStr()

  function prevMonth() {
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))
  }
  function nextMonth() {
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))
  }
  function pick(d: number) {
    const s = toStr(view.y, view.m, d)
    if (min && s < min) return
    onChange(s)
    setOpen(false)
  }

  return (
    <div className="datepicker" ref={rootRef}>
      <button
        type="button"
        className={`tasks__add-input datepicker__trigger${className ? ' ' + className : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {value ? fmtDisplay(value) : <span className="datepicker__placeholder">日付を選択</span>}
      </button>
      {open && (
        <div
          className={`datepicker__pop${openUp ? ' datepicker__pop--up' : ''}`}
          role="dialog"
          aria-label={ariaLabel ?? '日付を選択'}
        >
          <div className="datepicker__nav">
            <button
              type="button"
              className="datepicker__navbtn"
              onClick={prevMonth}
              aria-label="前の月"
            >
              ‹
            </button>
            <span className="datepicker__month">
              {view.y}年{view.m + 1}月
            </span>
            <button
              type="button"
              className="datepicker__navbtn"
              onClick={nextMonth}
              aria-label="次の月"
            >
              ›
            </button>
          </div>
          <div className="datepicker__grid" role="grid">
            {dowHeaders.map((w, i) => {
              const real = (weekStart + i) % 7
              return (
                <span
                  key={w}
                  className={`datepicker__dow${real === 0 ? ' is-sun' : ''}${real === 6 ? ' is-sat' : ''}`}
                >
                  {w}
                </span>
              )
            })}
            {cells.map((d, i) => {
              if (d === null) return <span key={i} className="datepicker__cell datepicker__cell--empty" />
              const s = toStr(view.y, view.m, d)
              const disabledDay = !!min && s < min
              const isSel = s === value
              const isToday = s === today
              const real = new Date(view.y, view.m, d).getDay()
              return (
                <button
                  key={i}
                  type="button"
                  className={`datepicker__cell${isSel ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${real === 0 ? ' is-sun' : ''}${real === 6 ? ' is-sat' : ''}`}
                  onClick={() => pick(d)}
                  disabled={disabledDay}
                  aria-pressed={isSel}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
