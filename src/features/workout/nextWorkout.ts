// 姉妹ツール「AB Workout」の次回1回分メニューを表す型。
// AB Workout の全データ JSON（BackupExporter 形式）の plannedWorkouts / routineItems /
// plannedSets / exercises から「次回1回分（status=PENDING で orderInWeek 最小）」を抽出・整形した形。
// いまはデータの受け渡し方法（カレンダー経由／公開JSON／中継サーバー）が未定のため、
// 実装は sample-data 由来のモック（下の NEXT_WORKOUT_MOCK）で進める。将来ここへ
// 取得フック（例: useNextWorkout()）を足し、同じ型を返すようにすれば表示側はそのまま使える。

// 1セット分の目標。ウォームアップ（'warmup'）と本番（'work'）を区別する。
export interface PlannedSet {
  type: 'warmup' | 'work'
  weight: number
  unit: string // 'kg' など（小文字）
  repsMin: number
  repsMax: number // 単一回数なら repsMin と同値
}

// 1種目分。bodyPart は日本語の部位名（胸・肩・腕…）に変換済み。note は AI の一言メモ（無ければ null）。
export interface PlannedExercise {
  name: string
  bodyPart: string
  note: string | null
  sets: PlannedSet[]
}

// 次回1回分のメニュー全体。
export interface NextWorkout {
  sessionLabel: string // 例: "Day1: 胸・肩・腕"
  orderInWeek: number // 週内の順番（1始まり）
  totalInWeek: number // 今週の予定回数
  doneInWeek: number // 今週すでに消化した回数
  scheduledDate: string | null // 予定日（未設定なら null）
  exercises: PlannedExercise[]
}

// sample-data/latest.json から抽出した実際の「次回1回分」（ダミーデータ）。
// 抽出ロジック: 最新の aiSession に属する plannedWorkouts のうち status='PENDING' で
// orderInWeek が最小のものを1件選び、その routine の routineItems（種目・AIメモ）と
// plannedSets（目標セット）、exercises（種目名・部位）を突き合わせて整形した。
export const NEXT_WORKOUT_MOCK: NextWorkout = {
  sessionLabel: 'Day1: 胸・肩・腕',
  orderInWeek: 1,
  totalInWeek: 3,
  doneInWeek: 0,
  scheduledDate: null,
  exercises: [
    {
      name: 'ダンベルベンチプレス',
      bodyPart: '胸',
      note: '前回17.5kgから1ステップアップの20kgに挑戦。コントロールを意識します。',
      sets: [
        { type: 'warmup', weight: 15, unit: 'kg', repsMin: 10, repsMax: 10 },
        { type: 'work', weight: 20, unit: 'kg', repsMin: 8, repsMax: 10 },
        { type: 'work', weight: 20, unit: 'kg', repsMin: 8, repsMax: 10 },
        { type: 'work', weight: 20, unit: 'kg', repsMin: 8, repsMax: 10 },
      ],
    },
    {
      name: 'ダンベルショルダープレス',
      bodyPart: '肩',
      note: '前回9kgから10kgへ1ステップ重量を上げ、丁寧なストロークで行います。',
      sets: [
        { type: 'work', weight: 10, unit: 'kg', repsMin: 8, repsMax: 10 },
        { type: 'work', weight: 10, unit: 'kg', repsMin: 8, repsMax: 10 },
        { type: 'work', weight: 10, unit: 'kg', repsMin: 8, repsMax: 10 },
      ],
    },
    {
      name: 'フレンチプレス',
      bodyPart: '腕',
      note: '前回高回数だったため、重量を上げて適切な筋肥大・筋力向上レンジへ調整します。',
      sets: [
        { type: 'work', weight: 8, unit: 'kg', repsMin: 10, repsMax: 12 },
        { type: 'work', weight: 8, unit: 'kg', repsMin: 10, repsMax: 12 },
        { type: 'work', weight: 8, unit: 'kg', repsMin: 10, repsMax: 12 },
      ],
    },
  ],
}
