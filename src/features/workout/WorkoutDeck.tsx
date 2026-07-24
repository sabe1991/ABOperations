import { NEXT_WORKOUT_MOCK } from './nextWorkout'
import type { NextWorkout, PlannedExercise, PlannedSet } from './nextWorkout'

// 姉妹ツール AB Workout の「今週のメニュー（次回1回分）」を朝刊の“続き面”として表示するカード。
// 朝刊レイアウトの下（PC で下スクロールした所）に置く読み取り専用の欄。データはいま
// モック（NEXT_WORKOUT_MOCK）だが、将来 useNextWorkout() 等に差し替えても表示側は変えなくてよい。

// 重量表示（例: 20 → "20"、17.5 → "17.5"）。JS では 20.0 は 20 になるため素直に文字列化でよい。
function formatWeight(w: number): string {
  return String(w)
}

// レップ範囲（例: 8–10 / 単一なら 10）。en dash（–）でつなぐ。
function formatReps(s: Pick<PlannedSet, 'repsMin' | 'repsMax'>): string {
  return s.repsMin === s.repsMax ? String(s.repsMin) : `${s.repsMin}–${s.repsMax}`
}

// 本番セットの要約。全セットが同一（重量・レップ範囲が揃っている）ならまとめて
// 「20kg × 8–10 × 3セット」と1行に、揃っていなければセットごとに「／」で列挙する。
function summarizeWork(
  sets: PlannedSet[],
): { weight: string; unit: string; reps: string; count: number }[] {
  const work = sets.filter((s) => s.type === 'work')
  const groups: { weight: string; unit: string; reps: string; count: number }[] = []
  for (const s of work) {
    const weight = formatWeight(s.weight)
    const reps = formatReps(s)
    const last = groups[groups.length - 1]
    // 直前のグループと重量・単位・レップが同じなら回数だけ足す（連続する同一セットをまとめる）。
    if (last && last.weight === weight && last.unit === s.unit && last.reps === reps) {
      last.count += 1
    } else {
      groups.push({ weight, unit: s.unit, reps, count: 1 })
    }
  }
  return groups
}

// ウォームアップ表示用の文字列（例: "W-up 15kg×10"）。複数あれば「, 」でつなぐ。無ければ null。
function warmupLabel(sets: PlannedSet[]): string | null {
  const warm = sets.filter((s) => s.type === 'warmup')
  if (warm.length === 0) return null
  return 'W-up ' + warm.map((s) => `${formatWeight(s.weight)}${s.unit}×${formatReps(s)}`).join(', ')
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
              <b>{g.weight}</b>
              {g.unit}
              <span className="deck-item__mul">×</span>
              {g.reps}
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

export function WorkoutDeck() {
  const data: NextWorkout = NEXT_WORKOUT_MOCK
  const totalSets = data.exercises.reduce(
    (n, ex) => n + ex.sets.filter((s) => s.type === 'work').length,
    0,
  )
  return (
    <section className="deck deck--workout" aria-label="今週のメニュー（次回）">
      <div className="deck__masthead">
        <div>
          <div className="deck__eyebrow">AB Workout ダッシュボードより</div>
          <h2 className="deck__title">今週のメニュー</h2>
        </div>
        <div className="deck__progress">
          今週の消化 <b>{data.doneInWeek}</b> / {data.totalInWeek} 回
        </div>
      </div>

      <div className="deck-session">
        <span className="deck-session__flag">次回</span>
        <span className="deck-session__name">{data.sessionLabel}</span>
        <span className="deck-session__meta">
          全{data.exercises.length}種目・{totalSets}セット
        </span>
      </div>

      <ul className="deck-items">
        {data.exercises.map((ex, i) => (
          <ExerciseRow key={i} ex={ex} />
        ))}
      </ul>
    </section>
  )
}
