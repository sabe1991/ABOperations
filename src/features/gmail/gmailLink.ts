// 「Gmail を開く」リンクの遷移先を、実行環境に応じて出し分ける（ユーザー要望）。
// スマホでは Gmail の**アプリ**を、PC では従来どおり web 版（新規タブ）を開く。
//
// - Android: `intent://…` URL で Gmail アプリ（`com.google.android.gm`）を起動する。
//   アプリ未導入なら `S.browser_fallback_url` により Chrome が web 版へ自動フォールバックする
//   （intent＝Android のアプリ起動の仕組み。Chrome 系ブラウザ独自拡張なので他ブラウザでは web のまま）。
//   パスに `/mail/u/0/` を付けると Gmail アプリのリンク受け付け条件に合いやすく、開く確度が上がる。
// - iOS: URL スキーム `googlegmail://`（Gmail アプリを直接呼び出す専用アドレス）で起動する。
//   未導入時は Safari がアラートを出すだけでページは残る（タイマーで web に飛ばす方式は
//   二重起動が起きやすく iOS では不安定なため採用しない）。
// - PC: `https://mail.google.com/` を新規タブで開く（従来どおり）。
//
// ※ アプリ用 URL（intent:// / googlegmail://）に target="_blank" を付けると空白タブが残るため、
//   モバイル時は新規タブにしない（newTab=false）。PanelLink 側で target/rel を出し分ける。

import { IS_ANDROID } from './renderBody'

// iOS 判定。iPadOS 13 以降は既定で Mac を偽装する（UA が Macintosh）ため、
// タッチ点数（maxTouchPoints>1＝実機の iPad）も併せて見る。
const IS_IOS: boolean = (() => {
  try {
    const ua = navigator.userAgent
    return (
      /iPhone|iPad|iPod/i.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    )
  } catch {
    return false
  }
})()

const GMAIL_WEB = 'https://mail.google.com/'
// Android の Gmail アプリを開く intent URL（未導入時は web へフォールバック）。
const GMAIL_ANDROID_INTENT =
  'intent://mail.google.com/mail/u/0/#Intent;scheme=https;action=android.intent.action.VIEW;' +
  `package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(GMAIL_WEB)};end`
// iOS の Gmail アプリを開く URL スキーム。
const GMAIL_IOS_SCHEME = 'googlegmail://'

export interface GmailLink {
  href: string
  newTab: boolean // true のときだけ target="_blank"（＋rel）で開く
}

// 現在の環境に応じた「Gmail を開く」リンク先を返す。
export function gmailLink(): GmailLink {
  if (IS_ANDROID) return { href: GMAIL_ANDROID_INTENT, newTab: false }
  if (IS_IOS) return { href: GMAIL_IOS_SCHEME, newTab: false }
  return { href: GMAIL_WEB, newTab: true }
}
