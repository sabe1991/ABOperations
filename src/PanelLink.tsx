// パネル見出しの右上に置く「外部サービスを開く」小さなリンクボタン。
// 予定→Google カレンダー / タスク→Google タスク / メール→Gmail を開く。
// 既定は新規タブ＋rel="noopener noreferrer"（参照元・window.opener を渡さない）。
// newTab=false のときは同一コンテキストで遷移する（スマホでアプリを起動する intent:// や
// googlegmail:// は、新規タブにすると空白タブが残るため target/rel を付けない）。
export function PanelLink({
  href,
  label,
  newTab = true,
}: {
  href: string
  label: string
  newTab?: boolean
}) {
  return (
    <a
      className="panel__link"
      href={href}
      // 新規タブのときだけ target/rel を付ける（アプリ起動 URL では付けない）。
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      title={label}
      aria-label={label}
    >
      <span aria-hidden="true">↗</span>
    </a>
  )
}
