import { useState } from 'react'
import { useWeekPlan } from './useWeekPlan'
import type { PlannedExercise, PlannedSession, PlannedSet, SessionStatus } from './nextWorkout'

// 姉妹ツール AB Workout の「今週のメニュー」を朝刊の“続き面”として表示するカード。
// 既定で「次回（未実施の次の1回）」を表示し、＜／＞ で週内の前後の回へ送れる。
// 朝刊レイアウトの下（PC で下スクロールした所）に置く読み取り専用の欄。
// データは Secret Gist の week.json を useWeekPlan() で取得する（未取得・失敗・空なら欄ごと出さない）。

// 数値表示（例: 20 → "20"、17.5 → "17.5"）。JS では 20.0 は 20 になるため素直に文字列化でよい。
function fmt(n: number): string {
  return String(n)
}

// レップ範囲（例: 8–10 / 単一なら 10）。en dash（–）でつなぐ。
function formatReps(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`
}

// 連続する同一の本番セットをまとめた1グループ。重量×レップ系と時間系（durationSec）の両対応。
interface WorkGroup {
  weight: number | null
  unit: string | null
  reps: string | null // 重量系のときのレップ表示（時間系では null）
  durationSec: number | null // 時間系のときの秒数（重量系では null）
  count: number
}

// 本番セットの要約。連続する同一セット（重量・単位・レップ or 秒数が同じ）をまとめて回数にする。
// 例: 20kg×8–10 が3本なら1グループ（count=3）、45秒が2本なら1グループ（count=2）。
function summarizeWork(sets: PlannedSet[]): WorkGroup[] {
  const groups: WorkGroup[] = []
  for (const s of sets) {
    if (s.type !== 'work') continue
    const reps = s.repsMin != null && s.repsMax != null ? formatReps(s.repsMin, s.repsMax) : null
    const last = groups[groups.length - 1]
    if (
      last &&
      last.weight === s.weight &&
      last.unit === s.unit &&
      last.reps === reps &&
      last.durationSec === s.durationSec
    ) {
      last.count += 1
    } else {
      groups.push({ weight: s.weight, unit: s.unit, reps, durationSec: s.durationSec, count: 1 })
    }
  }
  return groups
}

// ウォームアップ表示用の文字列（例: "W-up 15kg×10" / 時間系は "W-up 30秒"）。無ければ null。
function warmupLabel(sets: PlannedSet[]): string | null {
  const warm = sets.filter((s) => s.type === 'warmup')
  if (warm.length === 0) return null
  const parts = warm.map((s) => {
    if (s.durationSec != null) return `${s.durationSec}秒`
    const reps = s.repsMin != null && s.repsMax != null ? formatReps(s.repsMin, s.repsMax) : ''
    return `${s.weight != null ? fmt(s.weight) : ''}${s.unit ?? ''}×${reps}`
  })
  return 'W-up ' + parts.join(', ')
}

// セッションの状態を、表示用のラベルへ。next=true（未実施の次の1回）だけ「次回」と強調する。
function statusLabel(status: SessionStatus, isNext: boolean): string {
  if (status === 'COMPLETED') return '完了'
  if (status === 'SKIPPED') return 'スキップ'
  return isNext ? '次回' : '予定'
}

function ExerciseRow({ ex }: { ex: PlannedExercise }) {
  const groups = summarizeWork(ex.sets)
  const warm = warmupLabel(ex.sets)
  return (
    <li className="deck-item">
      <div className="deck-item__head">
        <span className="deck-item__name">{ex.name}</span>
        <span className="deck-item__chip">{ex.bodyPart}</span>
        <span className="deck-item__target">
          {groups.map((g, i) => (
            <span key={i} className="deck-item__group">
              {i > 0 && <span className="deck-item__slash">／</span>}
              {g.durationSec != null ? (
                <>
                  <b>{g.durationSec}</b>秒
                </>
              ) : (
                <>
                  <b>{g.weight != null ? fmt(g.weight) : '—'}</b>
                  {g.unit}
                  <span className="deck-item__mul">×</span>
                  {g.reps}
                </>
              )}
              <span className="deck-item__mul">×</span>
              <span className="deck-item__sets">{g.count}セット</span>
            </span>
          ))}
        </span>
      </div>
      {(warm || ex.note) && (
        <div className="deck-item__sub">
          {warm && <span className="deck-item__warmup">{warm}</span>}
          {ex.note && <span className="deck-item__note">{ex.note}</span>}
        </div>
      )}
    </li>
  )
}

function SessionView({ session, isNext }: { session: PlannedSession; isNext: boolean }) {
  const totalSets = session.exercises.reduce(
    (n, ex) => n + ex.sets.filter((s) => s.type === 'work').length,
    0,
  )
  return (
    <>
      <div className="deck-session">
        <span
          className={`deck-session__flag deck-session__flag--${session.status.toLowerCase()}${
            isNext ? ' deck-session__flag--next' : ''
          }`}
        >
          {statusLabel(session.status, isNext)}
        </span>
        <span className="deck-session__name">{session.sessionLabel}</span>
        <span className="deck-session__meta">
          全{session.exercises.length}種目・{totalSets}セット
        </span>
      </div>
      <ul className="deck-items">
        {session.exercises.map((ex, i) => (
          <ExerciseRow key={i} ex={ex} />
        ))}
      </ul>
    </>
  )
}

export function WorkoutDeck() {
  const { data: plan } = useWeekPlan()
  // ユーザーが ‹ › で選んだ回。未操作のうちは null で、既定の「次回」を表示する。
  const [index, setIndex] = useState<number | null>(null)

  // 取得前・失敗・空プランのときは欄ごと出さない（朝刊の続き面なので無ければ黙って畳む）。
  if (!plan || plan.sessions.length === 0) return null
  const sessions = plan.sessions

  // 未実施の次の1回（＝週内で最初の PENDING）のインデックス。無ければ先頭。
  const nextIndex = Math.max(
    0,
    sessions.findIndex((s) => s.status === 'PENDING'),
  )
  // 表示中の回。既定は「次回」。ユーザー選択があればそれを使い、範囲外は端に丸める
  // （再取得で回数が減っても破綻しないように）。
  const current = Math.min(index ?? nextIndex, sessions.length - 1)
  const session = sessions[current]
  const hasPrev = current > 0
  const hasNext = current < sessions.length - 1

  return (
    <section className="deck deck--workout" aria-label="今週のメニュー">
      <div className="deck__masthead">
        <div>
          <div className="deck__eyebrow">AB Workout ダッシュボードより</div>
          <h2 className="deck__title">今週のメニュー</h2>
        </div>
        <div className="deck__progress">
          今週の消化 <b>{plan.doneInWeek}</b> / {plan.totalInWeek} 回
        </div>
      </div>

      {/* 回送りナビ（前へ／位置／次へ）。週内の各回を1回ずつ切り替える。 */}
      <div className="deck-nav">
        <button
          className="deck-nav__btn"
          onClick={() => setIndex(current - 1)}
          disabled={!hasPrev}
          aria-label="前の回"
          title="前の回"
        >
          ‹
        </button>
        <span className="deck-nav__pos" aria-live="polite">
          {current + 1} / {sessions.length} 回目
        </span>
        <button
          className="deck-nav__btn"
          onClick={() => setIndex(current + 1)}
          disabled={!hasNext}
          aria-label="次の回"
          title="次の回"
        >
          ›
        </button>
      </div>

      <SessionView session={session} isNext={current === nextIndex} />
    </section>
  )
}
