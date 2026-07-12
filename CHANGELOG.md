# 変更履歴

## Added

- フェーズ1(公開フロー確立)完了。React + Vite + TypeScript の最小プロジェクトを scaffold し、GitHub Pages 自動デプロイ用の GitHub Actions ワークフロー(`.github/workflows/deploy.yml`)を作成。GitHub 公開リポジトリ `sabe1991/ABOperations` を作成し、Pages のソースを「GitHub Actions」に設定してデプロイ成功を確認した(公開URL: https://sabe1991.github.io/ABOperations/ が HTTP 200 で表示、JS/CSS/画像アセットが base path `/ABOperations/` 配下で解決、バンドルにコミットハッシュが埋め込まれデプロイ反映を目視確認できることを検証済み)。暫定画面(`src/App.tsx`)はアプリ名・アセット画像・ビルド情報(コミットハッシュ/ビルド日時)を表示する (2026-07-12)
- プロジェクト開始。グリルセッションでダッシュボードの設計を合意し、`PLAN.md`(設計合意書)、`TODO.md`、`STATE.md` を作成した (2026-07-12)

## Changed

- `PLAN.md` にプロUI/UXデザイナー視点+シニアエンジニア視点のレビュー結果を反映。(1)誤操作対策(完了・アーカイブ・削除の Undo、操作の3層配置)、(2)スマホタブのバッジと初期タブ、(3)例外状態(未ログイン/空/エラー/読み込み中)の設計、(4)再ログイン頻度の現実的な見積もりへの修正と段階的認可の採用、(5)メール本文表示のセキュリティ対策(サニタイズ+隔離枠+画像ブロック)、(6)API実装の落とし穴メモ、(7)縦切り実装の段取り、などを追記。`TODO.md` に #6〜#8 を追加 (2026-07-12)

## Fixed
