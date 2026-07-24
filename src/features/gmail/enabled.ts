// 「この端末で Gmail パネルを表示するか」の端末ローカル設定（localStorage）。
//
// Gmail の「同意済み(grantedScopes)」とは別物として持つ（Fable 助言）。
// 同意は Google アカウント単位なので、例えば会社PCで「アカウントとしては同意済みだが
// この端末では表示オフ」という状態を正しく表現できる。
// 判定: gmailEnabled(この端末) かつ grantedScopes に gmail.modify がある。
//
// 設定モーダルと Gmail パネルの両方から切り替わり、片方の変更をもう片方へ即反映したいので、
// 単なる localStorage 読み書きではなく購読可能な小さなストアにする（useSyncExternalStore）。

import { useSyncExternalStore } from 'react'

const KEY = 'abops:gmailEnabled'

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    // 未設定（キーが無い）ときは既定で ON にする（Gmail を既定表示・ユーザー要望）。
    // 明示的に OFF にした端末は '0' が入るので、それは false として扱う。
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

let enabled = read()
const listeners = new Set<() => void>()

export function isGmailEnabled(): boolean {
  return enabled
}

export function setGmailEnabled(value: boolean): void {
  enabled = value
  try {
    // 既定が ON になったため、OFF はキー削除ではなく '0' を明示保存して「意図的に OFF」を残す
    // （削除すると未設定＝既定 ON に戻ってしまうため）。
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    // localStorage が使えない環境でも致命的ではない（メモリ上の値で動作継続）
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// React から現在の有効状態を購読する。設定側で切り替えるとパネル側も即再描画される。
export function useGmailEnabled(): boolean {
  return useSyncExternalStore(subscribe, isGmailEnabled)
}
