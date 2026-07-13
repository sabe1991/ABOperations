// パネル見出しの右上に置く「外部サービスを開く」小さなリンクボタン。
// 予定→Google カレンダー / タスク→Google タスク / メール→Gmail を新規タブで開く。
// 新規タブ＋rel="noopener noreferrer" で開く（参照元・window.opener を渡さない）。
export function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="panel__link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
    >
      <span aria-hidden="true">↗</span>
    </a>
  )
}
