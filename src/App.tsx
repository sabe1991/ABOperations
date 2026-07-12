import viteLogo from '/vite.svg'

// フェーズ1（公開フロー確立）用の暫定画面。
// ここでは (1) GitHub Pages への自動デプロイが通ること、(2) base path 配下で
// アセット（画像）が正しく解決されること、(3) デプロイが実際に反映されたか
// をビルド情報で確認できること、の3点を検証する。UI はフェーズ2で作り直す。
export default function App() {
  // ビルド時刻を日本時間で読みやすく整形する。
  const buildTime = new Date(__BUILD_TIME__).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
  })

  return (
    <main className="hello">
      <img src={viteLogo} alt="" className="hello__logo" width={72} height={72} />
      <h1 className="hello__title">AB Operations</h1>
      <p className="hello__lead">
        フェーズ1: GitHub Pages への公開フローを確認するための暫定画面です。
      </p>
      <dl className="hello__build">
        <div>
          <dt>コミット</dt>
          <dd>
            <code>{__COMMIT_HASH__}</code>
          </dd>
        </div>
        <div>
          <dt>ビルド日時</dt>
          <dd>{buildTime}</dd>
        </div>
      </dl>
    </main>
  )
}
