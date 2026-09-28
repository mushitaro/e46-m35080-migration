'use client';

/**
 * CREDITS - who this is built on, and the people who carry it. The MEDAL beside PRIVACY opens it,
 * in every build, as in TUNER, MONITORING, SMG2 and BOOT.
 *
 * Named sources first (tsunagi-m-chrome section 4): each entry says what the work was and what in
 * this app rests on it, taken from THIRD-PARTY-NOTICES.md sections 2 and 3 - change that file
 * first, and this one follows it. Then the build, for the person about to write to the author.
 * Then the colophon, last and dim: MESH, linked from here and nowhere else, and the people who
 * bought MILE for this tool on MESH and agreed to be named, most MILE first, names only.
 *
 * The names are written into the page at build time (scripts/inject-supporters.mjs), so reading
 * them is no request: production still sends nothing. A dev server has no list and shows only the
 * MESH line.
 *
 * Not a gate: X, Escape and the scrim all close it. A floating surface, so one of the outlines
 * check_ui_tokens.mjs allows.
 */

import { useEffect, useRef, useState } from 'react';
import { Medal, X } from 'lucide-react';
import { LABEL, Pane } from '@/components/ui';
import { getLang, type Lang } from '@/lib/i18n';
import { readSupporters } from '@/lib/supporters';

const MESH: Record<Lang, string> = {
  ja: 'https://m3.tsunagi.app/mesh',
  en: 'https://m3.tsunagi.app/en/mesh',
};

const COPY = {
  ja: {
    open: 'Credits & attribution',
    title: 'CREDITS — 出典',
    close: '閉じる',
    intro:
      '本アプリは、先に公開してくださった方々の仕事と、BMW の資料の上に成り立っています。以下に、その仕事と、本アプリのどこがそれに拠っているかを記します。',
    entries: [
      {
        who: 'gerchanovsky — m35080_odometer_fix',
        what: 'M35080 の SPI の読み書きと、走行距離・VIN の符号化。本アプリのこれらの処理は、ここから来ています。配線図のジャンパーの色も、比べやすいようにこのリポジトリに合わせています。',
      },
      {
        who: 'kaeferfreund — m35080_Read_BitBang',
        what: '上のリポジトリの元になった、M35080 のビットバング読み出し。',
      },
      {
        who: 'BMW NCS Expert / SGBD',
        what: 'CODING と TEST が使うメーターのコーディング定義と、キーワード・ランプ・入力・故障の名前の出所。運営者の手元のファイルから作り、ワークス版でサインインしたオーナーさんにだけ渡しています。リポジトリには入っていません。',
      },
      {
        who: 'E46M3 /// MONITORING',
        what: '実車で測った DS2 の通信（ds2-core）。TEST がベンチのメーターと話すのは、この写しです。',
      },
    ],
    notices: 'ライセンスと出所の全文は THIRD-PARTY-NOTICES.md にあります。',
    build: 'ビルド',
    meshLead: '本アプリは TSUNAGI のコミュニティに繋がっています。研究の続きと、支えてくださる方々の一覧は',
    meshTail: 'に。',
    supportersLead: 'このツールを支えてくださっている方々',
    supportersOthers: 'ほか、名前を出さずに支えてくださっている方々',
    supportersAsOf: (date: string) => `${date} 時点・MILE の多い順`,
  },
  en: {
    open: 'Credits & attribution',
    title: 'CREDITS',
    close: 'Close',
    intro:
      'This app is built on work others published first, and on BMW’s own data. Each entry below names that work, and what in this application rests on it.',
    entries: [
      {
        who: 'gerchanovsky — m35080_odometer_fix',
        what: 'The SPI reads and writes of the M35080, and the odometer and VIN encoding. This application’s handling of those comes from it; the jumper colours in the wiring diagram follow it, so the two can be compared.',
      },
      {
        who: 'kaeferfreund — m35080_Read_BitBang',
        what: 'The bit-banged M35080 reader the repository above was forked from.',
      },
      {
        who: 'BMW NCS Expert / SGBD',
        what: 'Where the cluster coding definitions, and the names of keywords, lamps, inputs and faults that CODING and TEST use, come from. Built from the operator’s own files and handed only to signed-in owners in the WORKS build; not in the repository.',
      },
      {
        who: 'E46M3 /// MONITORING',
        what: 'The DS2 link measured on a car (ds2-core). TEST talks to a cluster on the bench through a copy of it.',
      },
    ],
    notices: 'The full licence and provenance position is in THIRD-PARTY-NOTICES.md.',
    build: 'Build',
    meshLead: 'This app is part of the TSUNAGI community. The research continues, and the people who carry it are listed, at',
    meshTail: '.',
    supportersLead: 'Carried by',
    supportersOthers: '…and others who chose not to be named',
    supportersAsOf: (date: string) => `As of ${date}, most MILE first`,
  },
} as const;

/** The MEDAL in the header: the same size and neutral grey as PRIVACY beside it. */
export function CreditsButton({ onOpen }: { onOpen: () => void }) {
  const label = COPY[getLang()].open;
  return (
    <button type="button" onClick={onOpen} title={label} aria-label={label} className="text-slate-500 transition-colors hover:text-slate-300">
      <Medal className="h-5 w-5" />
    </button>
  );
}

export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const lang = getLang();
  const c = COPY[lang];
  const card = useRef<HTMLDivElement>(null);
  // Read once, when the dialog opens: the list is in the page, not the bundle.
  const [supporters] = useState(readSupporters);
  const [buildId] = useState(
    () => (typeof document === 'undefined' ? null : document.querySelector('meta[name="build-id"]')?.getAttribute('content')) ?? null,
  );
  const named = supporters && (supporters.names.length > 0 || supporters.others);

  useEffect(() => {
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm" onClick={onClose} />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credits-title"
        lang={lang}
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-[110] flex max-h-[80vh] w-[440px] max-w-[calc(100vw-24px)]
                   -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-700 bg-slate-900 p-4
                   shadow-xl outline-none"
      >
        <div className="flex h-6 shrink-0 items-center gap-2">
          <Medal className="h-4 w-4 shrink-0 text-slate-500" />
          <h2 id="credits-title" className={`${LABEL} min-w-0 flex-1 text-slate-300`}>
            {c.title}
          </h2>
          <button type="button" onClick={onClose} title={c.close} aria-label={c.close} className="shrink-0 text-slate-500 transition-colors hover:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <Pane>
            <p className="text-[11px] leading-relaxed text-slate-300">{c.intro}</p>
            {c.entries.map((e) => (
              <div key={e.who} className="flex gap-2 text-[11px] leading-relaxed text-slate-300">
                <span className="shrink-0 text-slate-600">—</span>
                <p>
                  <span className="font-bold text-slate-100">{e.who}</span>
                  {' — '}
                  {e.what}
                </p>
              </div>
            ))}
            <p className="text-[10px] leading-relaxed text-slate-500">{c.notices}</p>

            {buildId && (
              <p className="border-t border-slate-800 pt-2 font-mono text-[10px] text-slate-600">
                {c.build} {buildId}
              </p>
            )}

            {/* The colophon, under the build line's rule - a second rule on the same edge would
                draw a box. Neutral: it states no machine state, so it borrows no accent. */}
            <div className="text-[10px] leading-relaxed text-slate-600">
              <span className="font-mono uppercase tracking-widest">integrated by tsunagi</span>
              {supporters && named && (
                <div className="mt-2">
                  <p className="text-slate-500">{c.supportersLead}</p>
                  {supporters.names.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                      {supporters.names.map((n, i) => (
                        <span key={`${i}:${n}`}>{n}</span>
                      ))}
                    </p>
                  )}
                  {supporters.others && <p className="mt-1">{c.supportersOthers}</p>}
                  <p className="mt-1 font-mono">{c.supportersAsOf(supporters.asOf)}</p>
                </div>
              )}
              <p className="mt-2">
                {c.meshLead}{' '}
                <a
                  href={MESH[lang]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-300"
                >
                  MESH
                </a>
                {c.meshTail}
              </p>
            </div>
          </Pane>
        </div>
      </div>
    </>
  );
}
