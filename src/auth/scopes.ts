// 接続・再接続・サイレント認証で「今この端末が要求すべきスコープ(権限範囲)」を決める。
//
// 以前は再接続の入口ごとに要求スコープがバラバラで、ヘッダ/バナーの「再接続」だけが
// 常に INITIAL_SCOPES(カレンダー+Tasks のみ)を要求していた。そのため Gmail を有効化した
// 端末で1時間ごとの失効後にヘッダの再接続を押すと、Gmail 権限を持たない新トークンになり、
// Gmail が 403(権限不足)→ needsScope で Tasks まで巻き添えで停止する不具合があった。
// 全接続入口をこの1関数に集約し、要求スコープの判断を一元化する。

import { GMAIL_SCOPES, INITIAL_SCOPES, SCOPES } from '../config'
import { loadGrantedScopes } from './tokenStore'
import { isGmailEnabled } from '../features/gmail/enabled'

// この端末で Gmail を有効化し、かつ既に gmail.modify に同意済みなら Gmail 込みで要求する。
// それ以外(Gmail 未有効 or 未同意の端末)は初期スコープのみ。未同意の Gmail をここで
// 勝手に要求しない(サイレント認証で新規同意画面を暗黙に出さないため)。
export function desiredScopes(): string[] {
  return isGmailEnabled() && loadGrantedScopes().includes(SCOPES.gmailModify)
    ? GMAIL_SCOPES
    : INITIAL_SCOPES
}
