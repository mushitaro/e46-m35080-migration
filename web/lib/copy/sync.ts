/**
 * The words of the preview's SYNC panel, its PRIVACY link and its first-run notice.
 *
 * Kept in their own file rather than in lib/copy/chrome.ts and lib/i18n.ts: all three exist only
 * in the preview build, and everything they say is in one place that production never draws.
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

/**
 * The first-run notice's heading: the app's name and what the build is called - WORKS since
 * 2026-09-25 (brand-label.mjs; the variant stays `preview`), as the manifest names it. A proper
 * noun, the same for every reader, so it is not in the language records below (lib/i18n.ts keeps
 * the app's name out of its records for the same reason).
 */
export const NOTICE_TITLE = 'E46 M35080 /// MIGRATION — WORKS';

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
  privacyTitle: 'プライバシーポリシー（ワークス版）',
  /* The first-run notice (components/PreviewNotice.tsx). m3's words - tsunagi-m3's NOTICE_COPY,
     with `sessions` from its NOTICE_APPS['m35080-preview'] - except `records`, `recordsWhen` and
     `alsoSent`, which say what THIS app sends (operator, 2026-09-24): an error record only when a
     connection, read, backup or write fails or is refused (useM35080Link's fail() and refuse()),
     and the browser type (navigator.userAgent) only in error records, never in a SYNCed session.
     The privacy policy says the same at length under #preview. Change the shared lines in m3 and
     here together, and keep these in step with what lib/sync/cloud.ts and errorRecords.ts send. */
  notice: {
    lead: 'このワークス版は、保存した記録を別の端末でも開けるよう、また不具合を調べられるよう、次のものを運営者のサーバーへ送ります。',
    sessionsTitle: '保存したセッション',
    sessions: 'メーターの EEPROM イメージ（VIN の下 7 桁と走行距離を含む）と、バックアップ・書き換え・復元の記録',
    sessionsWhen: 'SYNC を押して保存したときに送ります。',
    recordsTitle: 'エラーの記録',
    records: '接続・読み出し・バックアップ・書き込みが失敗したとき、または安全のために止めたときの、その段階とエラーの文面（VIN の下 7 桁、走行距離、ブリッジのファームウェアの版を含む）',
    recordsWhen: '失敗したときに自動で送ります。通信できないときは端末に残し、次に送ります。',
    alsoSent: 'どちらにも、アプリの版が付きます。エラーの記録には、ブラウザの種類も付きます。',
    purposeTitle: '使いみち',
    purpose: 'ご本人が別の端末で記録を開くため、そして不具合を調べてツールを直すためだけに使います。',
    whereTitle: '保存先と、見られる人',
    where: 'Cloudflare のデータベース（アジア太平洋地域）に、アカウントごとに分けて保存します。見られるのは、ご本人と運営者だけです。',
    deleteTitle: '削除',
    deleteBody: '保存したセッションとエラーの記録は、アプリの中でいつでも削除できます。まとめて削除したいときは、Discord からご連絡ください。',
    policy: '詳しくはプライバシーポリシー',
    confirm: '確認して続ける',
  },
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
  privacyTitle: 'Privacy policy (WORKS)',
  notice: {
    lead: 'So that what you save opens on your other devices, and so that faults can be investigated, this WORKS build sends the following to our server.',
    sessionsTitle: 'Sessions you save',
    sessions: 'the cluster EEPROM image (including the last seven characters of the VIN and the mileage) and the backup, rewrite and restore history',
    sessionsWhen: 'Sent when you press SYNC to save one.',
    recordsTitle: 'Error records',
    records: 'when a connection, read, backup or write fails, or is stopped for safety: the step and its error text (including the last seven characters of the VIN, the mileage and the bridge firmware version)',
    recordsWhen: 'Sent automatically when something fails. Without a connection they wait on the device and go next time.',
    alsoSent: 'Both carry the app version; error records also carry the browser type.',
    purposeTitle: 'What it is for',
    purpose: 'Only for opening your records on your other devices, and for finding and fixing faults in the tool.',
    whereTitle: 'Where it is kept, and who can see it',
    where: 'In a Cloudflare database (Asia-Pacific), kept separately per account. Only you and the operator can see it.',
    deleteTitle: 'Deleting it',
    deleteBody: 'You can delete saved sessions and error records in the app at any time. To have everything deleted at once, contact us on Discord.',
    policy: 'Privacy policy, in full',
    confirm: 'Confirm and continue',
  },
};

export function syncCopy(): SyncCopy {
  return getLang() === 'ja' ? JA : EN;
}
