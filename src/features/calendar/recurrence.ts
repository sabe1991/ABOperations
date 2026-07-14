// 繰り返しルール（RRULE）の最小パーサ／ビルダー（#3）。
// Google カレンダー本家の全機能（BYDAY の細かな指定など）は扱わず、
// 個人利用で頻出する「毎日／毎週／隔週／毎月／毎年 ＋ 間隔 ＋ 終了条件」だけを対象にする。
// これで TODO #3 の主目的「毎週→隔週」などの変更をアプリ内で完結できる。

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

// 終了条件: なし／回数指定（COUNT）／日付指定（UNTIL, ローカル 'YYYY-MM-DD'）。
export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'count'; count: number }
  | { type: 'until'; date: string }

export interface RecurrenceRule {
  freq: Freq
  interval: number // 1=毎回, 2=隔回 …
  end: RecurrenceEnd
}

// 既定のルール（毎週・間隔1・終了なし）。ルールが読めなかったときのフォールバックにも使う。
export function defaultRule(): RecurrenceRule {
  return { freq: 'WEEKLY', interval: 1, end: { type: 'never' } }
}

// Date → ローカルの 'YYYY-MM-DD'（toISOString の UTC 変換による日付ズレを避ける）。
function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// UNTIL の値（'YYYYMMDD' か 'YYYYMMDDThhmmssZ'）を、表示・編集用のローカル 'YYYY-MM-DD' に変換する。
// 時刻付き(UTC)のときはローカルの暦日に直す（例 UTC 深夜が JST では翌日、の1日ズレを補正）。
function untilToDateStr(until: string): string | null {
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(until)
  if (dt) {
    const d = new Date(Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +dt[6]))
    return formatLocalDate(d)
  }
  const dateOnly = /^(\d{4})(\d{2})(\d{2})/.exec(until)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
  return null
}

// 'YYYY-MM-DD' を UNTIL の値に変換する。
// 終日予定は UNTIL も DATE 型 'YYYYMMDD' でなければならない（DTSTART の型と一致必須）。
// 時刻あり予定は「その日のローカル終端(23:59:59)」を UTC 日時にして送る（TZ ズレで翌日の回が
// 混ざる/落ちるのを防ぐ。例 JST 8:00 の予定を 7/14 まで、で 7/15 の回が残らないように）。
function dateStrToUntil(dateStr: string, allDay: boolean): string {
  const ymd = dateStr.replace(/-/g, '')
  if (allDay) return ymd
  const [y, m, d] = dateStr.split('-').map(Number)
  const localEnd = new Date(y, m - 1, d, 23, 59, 59)
  // '2026-07-14T14:59:59.000Z' → '20260714T145959Z'
  return localEnd.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

// recurrence 配列（例 ['RRULE:FREQ=WEEKLY;INTERVAL=2', 'EXDATE:...']）から RRULE を解析する。
// RRULE 行が無い／未対応の FREQ のときは null を返す（＝アプリ内編集の対象外）。
export function parseRecurrence(lines: string[] | undefined): RecurrenceRule | null {
  const rruleLine = (lines ?? []).find((l) => l.toUpperCase().startsWith('RRULE:'))
  if (!rruleLine) return null
  const params = new Map<string, string>()
  for (const kv of rruleLine.slice('RRULE:'.length).split(';')) {
    const [k, v] = kv.split('=')
    if (k && v) params.set(k.toUpperCase(), v.toUpperCase())
  }
  // このアプリが安全に往復（parse→build）できるのは FREQ/INTERVAL/COUNT/UNTIL だけ。
  // BYDAY（曜日指定）・BYMONTHDAY・BYSETPOS 等が付いた予定を「対応済み」と誤認して保存すると、
  // それらが build 時に欠落してシリーズ全体のスケジュールが黙って変わる（週3回→週1回など）。
  // 未対応キーが1つでもあれば null を返し、「編集不可（本家で編集）」の導線に流す。
  const SUPPORTED = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'])
  for (const key of params.keys()) {
    if (!SUPPORTED.has(key)) return null
  }
  const freq = params.get('FREQ')
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null
  }
  const interval = Math.max(1, Number(params.get('INTERVAL') ?? '1') || 1)
  let end: RecurrenceEnd = { type: 'never' }
  const count = params.get('COUNT')
  const until = params.get('UNTIL')
  if (count) {
    end = { type: 'count', count: Math.max(1, Number(count) || 1) }
  } else if (until) {
    const d = untilToDateStr(until)
    if (d) end = { type: 'until', date: d }
  }
  return { freq, interval, end }
}

// RecurrenceRule を Google カレンダーへ送る recurrence 配列に組み立てる。
// allDay は UNTIL の値型を DTSTART に合わせるために使う（終日=DATE / 時刻あり=DATE-TIME）。
export function buildRecurrence(rule: RecurrenceRule, allDay = false): string[] {
  const parts = [`FREQ=${rule.freq}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.end.type === 'count') parts.push(`COUNT=${rule.end.count}`)
  else if (rule.end.type === 'until') parts.push(`UNTIL=${dateStrToUntil(rule.end.date, allDay)}`)
  return [`RRULE:${parts.join(';')}`]
}

// 画面表示用の要約（例「隔週」「毎週・全10回」）。
export function describeRule(rule: RecurrenceRule): string {
  const base =
    rule.freq === 'DAILY'
      ? rule.interval === 1
        ? '毎日'
        : `${rule.interval}日ごと`
      : rule.freq === 'WEEKLY'
        ? rule.interval === 1
          ? '毎週'
          : rule.interval === 2
            ? '隔週'
            : `${rule.interval}週ごと`
        : rule.freq === 'MONTHLY'
          ? rule.interval === 1
            ? '毎月'
            : `${rule.interval}か月ごと`
          : rule.interval === 1
            ? '毎年'
            : `${rule.interval}年ごと`
  if (rule.end.type === 'count') return `${base}・全${rule.end.count}回`
  if (rule.end.type === 'until') return `${base}・${rule.end.date}まで`
  return base
}
