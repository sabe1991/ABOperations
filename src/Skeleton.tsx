// 読み込み中に表示するスケルトン（コンテンツの形をした灰色プレースホルダー）。
// 実データが来るまでの「間」を、テキスト「読み込み中…」より自然に見せるための装飾。
// アニメーション（シマー＝薄い光沢が流れる演出）は CSS 側。動きが苦手な人向けに
// prefers-reduced-motion では止める（CSS 側で対応）。装飾なので aria-hidden で読み上げ対象外にする。

// リスト系パネル（予定・タスク・メール）向け。1行＝見出し線＋補助線 を rows 本ぶん並べる。
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skel-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-list__row" key={i}>
          <div className="skeleton skel-list__title" />
          <div className="skeleton skel-list__sub" />
        </div>
      ))}
    </div>
  )
}

// 24hタイムライン向け。時間軸上の予定ブロックを模した、長さの違う縦積みバー。
export function TimelineSkeleton() {
  // 各バーの上位置(%)と高さ(px)をずらして、予定が点在している雰囲気を出す。
  const bars = [
    { top: '4%', height: 40 },
    { top: '20%', height: 64 },
    { top: '46%', height: 32 },
    { top: '62%', height: 52 },
    { top: '84%', height: 40 },
  ]
  return (
    <div className="skel-timeline" aria-hidden="true">
      {bars.map((b, i) => (
        <div
          className="skeleton skel-timeline__bar"
          key={i}
          style={{ top: b.top, height: b.height }}
        />
      ))}
    </div>
  )
}

// 天気向け。大きな絵文字ぶんの四角＋気温・情報の数本の線。
export function WeatherSkeleton() {
  return (
    <div className="skel-weather" aria-hidden="true">
      <div className="skeleton skel-weather__icon" />
      <div className="skel-weather__lines">
        <div className="skeleton skel-weather__line skel-weather__line--wide" />
        <div className="skeleton skel-weather__line" />
        <div className="skeleton skel-weather__line skel-weather__line--narrow" />
      </div>
    </div>
  )
}
