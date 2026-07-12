// 「この端末で Gmail パネルを表示するか」の端末ローカル設定（localStorage）。
//
// Gmail の「同意済み(grantedScopes)」とは別物として持つ（Fable 助言）。
// 同意は Google アカウント単位なので、例えば会社PCで「アカウントとしては同意済みだが
// この端末では表示オフ」という状態を正しく表現できる。
// 判定: gmailEnabled(この端末) かつ grantedScopes に gmail.modify がある。

const KEY = 'abops:gmailEnabled'

export function isGmailEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setGmailEnabled(value: boolean): void {
  try {
    if (value) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // localStorage が使えない環境でも致命的ではない
  }
}
