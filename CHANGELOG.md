# 変更履歴

## Added

- 起動時のサイレント再認証を実装。以前この端末でカレンダーに同意済み(`grantedScopes` に記録)なら、起動時に `requestAccessToken({ prompt: '' })` でポップアップ無し・クリック無しの自動ログインを試みる(`requestTokenSilent`/`trySilentConnect`)。成功すれば毎回のログイン操作が不要になる。失敗(セッション切れ・未同意・タイムアウト8秒)時は静かに通常のウェルカム画面へフォールバックする。トークンは従来どおりメモリ保持のみで永続化しない(セキュリティ方針は不変、UXのみ改善)。試行中は「接続中…」表示でログインボタンの点滅を防ぐ (2026-07-12)
- PWA マニフェスト(`public/manifest.webmanifest`)とアイコン(192/512/マスカブル512/apple-touch-icon 180)を追加し、Android の「ホーム画面に追加」でスタンドアロン起動(ブラウザのバー無しのアプリ風表示)できるようにした。iPhone 用の `apple-touch-icon`・`apple-mobile-web-app` メタも設定。start_url/scope/アイコンsrc は base path 配下で解決されるよう相対パスにした。Service Worker(オフライン対応)は初期スコープ外のまま (2026-07-12)
- フェーズ2(GISログイン+カレンダー読み取り)の実装。(1)認証をモジュールシングルトン(`tokenStore`=生トークンをメモリ保持/`gisClient`=GISトークンクライアントのPromiseラッパー)＋薄い外部ストア(`authStore`=isConnected/needsReconnect/grantedScopes/acquiredAt を useSyncExternalStore で購読)の二層構成で実装。(2)データ取得に TanStack Query を導入し、`QueryCache` のグローバル `onError` で 401(`AuthError`)を捕捉して自動的に再接続UXへ切り替え(該当クエリは `enabled` で自動停止、401はリトライしない)。(3)カレンダーは全カレンダーを並列取得し今日から7日分を日付ごとに時系列表示(`fetchUpcomingEvents`/`CalendarPanel`)。5分ポーリング+画面復帰時更新に対応。(4)未ログイン/ログイン/セッション切れ(再接続バナー1本)の画面状態と、再ログイン頻度の実機検証用にトークン取得時刻の表示を実装。段階的認可のためスコープを機能別にグループ化し初回はカレンダーのみ要求 (2026-07-12)
- フェーズ1(公開フロー確立)完了。React + Vite + TypeScript の最小プロジェクトを scaffold し、GitHub Pages 自動デプロイ用の GitHub Actions ワークフロー(`.github/workflows/deploy.yml`)を作成。GitHub 公開リポジトリ `sabe1991/ABOperations` を作成し、Pages のソースを「GitHub Actions」に設定してデプロイ成功を確認した(公開URL: https://sabe1991.github.io/ABOperations/ が HTTP 200 で表示、JS/CSS/画像アセットが base path `/ABOperations/` 配下で解決、バンドルにコミットハッシュが埋め込まれデプロイ反映を目視確認できることを検証済み)。暫定画面(`src/App.tsx`)はアプリ名・アセット画像・ビルド情報(コミットハッシュ/ビルド日時)を表示する (2026-07-12)
- プロジェクト開始。グリルセッションでダッシュボードの設計を合意し、`PLAN.md`(設計合意書)、`TODO.md`、`STATE.md` を作成した (2026-07-12)

## Changed

- `PLAN.md` にプロUI/UXデザイナー視点+シニアエンジニア視点のレビュー結果を反映。(1)誤操作対策(完了・アーカイブ・削除の Undo、操作の3層配置)、(2)スマホタブのバッジと初期タブ、(3)例外状態(未ログイン/空/エラー/読み込み中)の設計、(4)再ログイン頻度の現実的な見積もりへの修正と段階的認可の採用、(5)メール本文表示のセキュリティ対策(サニタイズ+隔離枠+画像ブロック)、(6)API実装の落とし穴メモ、(7)縦切り実装の段取り、などを追記。`TODO.md` に #6〜#8 を追加 (2026-07-12)

## Fixed
