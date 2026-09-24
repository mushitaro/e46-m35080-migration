/**
 * The words of the preview's SYNC panel and PRIVACY link.
 *
 * Kept in their own file rather than in lib/copy/chrome.ts and lib/i18n.ts: the panel exists only
 * in the preview build, and everything it says is in one place that production never draws.
 *
 * Two halves, the same split the rest of the app keeps (tsunagi-m-ux section 13):
 *   SYNC_WORDS  the instrument's words - buttons, headings, tags. Uppercase English for every
 *               reader, one word per thing.
 *   syncCopy()  prose, in the reader's language: what SYNC does, what happened, what to do next.
 */
import { getLang } from '@/lib/i18n';

export const SYNC_WORDS = {
  sync: 'SYNC',
  syncing: 'SYNCING',
  account: 'ACCOUNT',
  errors: 'ERRORS',
  restore: 'RESTORE',
  delete: 'DELETE',
  onDevice: 'ON THIS DEVICE',
  practice: 'PRACTICE',
  signIn: 'SIGN IN AGAIN',
  privacy: 'PRIVACY',
} as const;

/** Where the preview's privacy section is. The English UI reads the English policy. */
export function privacyUrl(): string {
  return getLang() === 'ja'
    ? 'https://m3.tsunagi.app/privacy-policy#preview'
    : 'https://m3.tsunagi.app/en/privacy-policy#preview';
}

const JA = {
  lead: 'この端末の記録（バックアップと、書き換え・リセット・復元のあとのイメージ）を、あなたのアカウントに保存します。別の端末でも取り出せます。',
  savedTo: (label: string) => `保存先 アカウント ${label}。このアカウントからだけ見えます。`,
  expired: 'サインインの期限が切れています。記録はこの端末に残っています。',
  unknown: 'アカウントを確認できません。記録はこの端末に残っています。',
  checking: 'アカウントを確認しています…',
  offline: 'オフラインです。記録はこの端末に残っています。',
  reauthWhenIdle: 'サインインし直すには、ブリッジを切断してください。',
  pending: (n: number) => (n === 0 ? 'この端末の記録は、すべてアカウントにあります。' : `アカウントにまだ無い記録が ${n} 件あります。`),
  sent: (n: number) => `${n} 件をアカウントへ送りました。`,
  nothingToSend: '送る記録はありません。すべてアカウントにあります。',
  sendFailed: '送れませんでした。記録はこの端末に残っています。もう一度お試しください。',
  sendExpired: 'サインインの期限が切れたため、送れませんでした。記録はこの端末に残っています。',
  tooLarge: '大きすぎて送れない記録があります。この端末には残っています。',
  restored: 'この端末の記録に戻しました。',
  restoreExists: 'この記録はすでにこの端末にあります。',
  restoreFailed: '取り出せませんでした。もう一度お試しください。',
  restoreBadHash: 'イメージがハッシュと一致しないため、戻しませんでした。',
  deleteConfirm: (what: string) => `${what} をアカウントから削除します。この端末の記録は残ります。削除したものはアカウントから戻せません。`,
  deleteDiagConfirm: 'このエラー記録をアカウントから削除します。',
  deleted: 'アカウントから削除しました。',
  accountEmpty: 'アカウントにはまだ記録がありません。',
  errorsLead: 'エラー記録は、操作が失敗したときにアプリが自動で送ります。問題の調査にだけ使います。',
  errorsEmpty: 'エラー記録はありません。',
  waiting: (n: number) => `送信待ち ${n} 件（次にサインインしているときに送ります）`,
  reauthConfirm: 'REWRITE でファイルに加えた変更のうち、SAVE EDITED で保存していないものは失われます。サインインし直しますか？',
  privacyTitle: 'プライバシーポリシー（プレビュー版）',
};

type SyncCopy = typeof JA;

const EN: SyncCopy = {
  lead: "Keeps this device's records - backups, and the image after each rewrite, reset or restore - in your account, so another device can bring them back.",
  savedTo: (label: string) => `Saving to account ${label}. Only this account can see them.`,
  expired: 'Your sign-in has expired. Your records are still on this device.',
  unknown: 'Cannot reach your account right now. Your records are still on this device.',
  checking: 'Checking your account…',
  offline: 'Offline. Your records are still on this device.',
  reauthWhenIdle: 'Disconnect the bridge to sign in again.',
  pending: (n: number) => (n === 0 ? 'Every record on this device is in your account.' : `${n} record(s) on this device are not in your account yet.`),
  sent: (n: number) => `Sent ${n} record(s) to your account.`,
  nothingToSend: 'Nothing to send: every record is already in your account.',
  sendFailed: 'Could not send. Your records are still on this device. Please try again.',
  sendExpired: 'Your sign-in has expired, so nothing was sent. Your records are still on this device.',
  tooLarge: 'A record is too large to send. It is still on this device.',
  restored: "Restored to this device's records.",
  restoreExists: 'This record is already on this device.',
  restoreFailed: 'Could not fetch it. Please try again.',
  restoreBadHash: 'Not restored: the image does not match its hash.',
  deleteConfirm: (what: string) => `Delete ${what} from your account? The copy on this device stays. This cannot be undone in the account.`,
  deleteDiagConfirm: 'Delete this error record from your account?',
  deleted: 'Deleted from your account.',
  accountEmpty: 'No records in your account yet.',
  errorsLead: 'Error records are sent by the app itself when an operation fails, and are used only to investigate the problem.',
  errorsEmpty: 'No error records.',
  waiting: (n: number) => `${n} waiting to send (sent the next time you are signed in)`,
  reauthConfirm: 'Changes made to the file on REWRITE and not saved with SAVE EDITED will be lost. Sign in again?',
  privacyTitle: 'Privacy policy (preview)',
};

export function syncCopy(): SyncCopy {
  return getLang() === 'ja' ? JA : EN;
}
