// Google Identity Services（GIS）のトークンクライアントをラップするモジュール。
//
// GIS の `initTokenClient` はコールバック方式で、コールバックは1つしか登録できない。
// そこで「保留中の resolver（Promise を完了させる関数）をモジュール変数に退避し、
// GIS のコールバックがそれを呼ぶ」という橋渡しパターンで Promise 化する（Fable 助言）。
//
// ⚠ 重要な制約:
// - `requestAccessToken()` は必ずユーザーのクリックハンドラから「同期的に」呼ぶこと。
//   await の後に呼ぶとブラウザがユーザー操作起点と見なさずポップアップをブロックする。
//   → requestToken() の中で client.requestAccessToken() を同期実行し、resolve だけ後回しにする。
// - GIS スクリプト（accounts.google.com/gsi/client）の読み込み完了前に初期化すると
//   window.google が undefined でエラーになる。ensureGisLoaded() で読み込みを待つ。

import { GOOGLE_CLIENT_ID } from '../config'
import { addGrantedScopes, setToken } from './tokenStore'

// GIS スクリプトの読み込み完了を待つ Promise（多重読み込みしないよう1つだけ保持）。
let gisLoadPromise: Promise<void> | null = null

function ensureGisLoaded(): Promise<void> {
  if (gisLoadPromise) return gisLoadPromise
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    // すでに読み込み済みなら即完了
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('GIS スクリプトの読み込みに失敗しました'))
    document.head.appendChild(script)
  })
  return gisLoadPromise
}

// スコープの組み合わせごとにトークンクライアントを1つ生成してキャッシュする。
// （スコープ文字列をキーにする。段階的認可で異なるスコープを要求するため）
const tokenClients = new Map<string, google.accounts.oauth2.TokenClient>()

// 現在保留中のトークン要求の resolver / rejecter。
// GIS のコールバックがこれを呼ぶことで Promise を完了させる。
let pendingResolve: ((token: string) => void) | null = null
let pendingReject: ((reason: Error) => void) | null = null

function getTokenClient(scopes: string[]): google.accounts.oauth2.TokenClient {
  const key = scopes.join(' ')
  const existing = tokenClients.get(key)
  if (existing) return existing

  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: key,
    // 同意成功時のコールバック。保留中の resolver に橋渡しする。
    callback: (response) => {
      if (response.access_token) {
        setToken(response.access_token, Date.now())
        // 実際に許可されたスコープを記録（段階的認可の判定用）
        addGrantedScopes(response.scope ? response.scope.split(' ') : scopes)
        pendingResolve?.(response.access_token)
      } else {
        pendingReject?.(new Error('アクセストークンを取得できませんでした'))
      }
      pendingResolve = null
      pendingReject = null
    },
    // ユーザーが同意をキャンセル / ポップアップを閉じた場合はこちらに来る。
    // Promise を reject して UI が「保留中」のまま固まらないようにする。
    error_callback: (error) => {
      pendingReject?.(new Error(error.type ?? 'ログインがキャンセルされました'))
      pendingResolve = null
      pendingReject = null
    },
  })
  tokenClients.set(key, client)
  return client
}

// 事前に GIS を読み込み、トークンクライアントを用意しておく（初回起動時に呼ぶ）。
// これによりクリック時には同期的に requestAccessToken() を呼べる。
export async function prepareTokenClient(scopes: string[]): Promise<void> {
  await ensureGisLoaded()
  getTokenClient(scopes)
}

// トークン要求の共通処理。resolver 退避パターン + タイムアウトのフォールバックを一元化する。
// options に { prompt: '' } を渡すとサイレント（ポップアップ無し）要求になる。
function doRequest(
  scopes: string[],
  options: { prompt?: string } | undefined,
  timeoutMs: number | null,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('GIS がまだ読み込まれていません。少し待ってから再試行してください。'))
      return
    }
    let settled = false
    // サイレント要求では callback も error_callback も返らないことが稀にあるため、
    // タイムアウトを設けて「認証中…」で固まるのを防ぐ（Fable 助言）。
    const timer =
      timeoutMs != null
        ? setTimeout(() => {
            if (settled) return
            settled = true
            pendingResolve = null
            pendingReject = null
            reject(new Error('認証がタイムアウトしました'))
          }, timeoutMs)
        : null
    // GIS のコールバックはこの退避した resolver/rejecter を呼ぶ。
    // settled ガードで二重解決・タイムアウト後の解決を無効化する。
    pendingResolve = (token) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(token)
    }
    pendingReject = (reason) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(reason)
    }
    const client = getTokenClient(scopes)
    // ⚠ ここは同期実行（await を挟まない）。ポップアップブロック回避のため。
    client.requestAccessToken(options)
  })
}

// トークンを要求する（明示的なログイン）。必ずクリックハンドラから同期的に呼ぶこと。
export function requestToken(scopes: string[]): Promise<string> {
  return doRequest(scopes, undefined, null)
}

// サイレント（ポップアップ無し）でトークンを要求する。起動時の自動ログインに使う。
// Googleセッションが生きていて同意済みなら UI 無しでトークンを取得できる。
// セッション切れ・未同意なら error_callback（または タイムアウト）で reject し、
// 呼び出し側は静かに通常のログインボタン表示にフォールバックする。
export function requestTokenSilent(scopes: string[]): Promise<string> {
  return doRequest(scopes, { prompt: '' }, 8000)
}
