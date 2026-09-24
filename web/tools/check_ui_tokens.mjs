#!/usr/bin/env node
// ============================================================================
//  check_ui_tokens.mjs — the ///M token rules, enforced instead of remembered
// ----------------------------------------------------------------------------
//  These four rules were all agreed before and all broken anyway, because a
//  convention that lives in a docstring is a convention you lose one busy edit
//  at a time. Micro-labels reached FOUR sizes (8/9/10/11px) across four element
//  types; the border rule was re-stated in three files and violated in two.
//
//  Run: node tools/check_ui_tokens.mjs
//
//  Ported from E46M3-Diagnosis (tsunagi-m-design section 4: "the checker only
//  lives in Diagnosis. Put it in every repo and run it."). Differences from the
//  reference, each forced by this repo rather than chosen:
//    - there is no src/: the app lives in app/, components/ and lib/
//    - OUTLINE_ALLOWED names this repo's six outlined things
//    - it runs as the first step of `npm run test`, so the same gate that
//      blocks a deploy on a failing test blocks it on a token violation
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCAN = ['app', 'components', 'lib'].map((d) => path.join(ROOT, d));
const UI = path.join(ROOT, 'components', 'ui.tsx');

/**
 * Arbitrary type sizes. There are two steps in the ramp and both live in ui.tsx.
 *
 * Two documented exceptions, both single values used by exactly one element:
 *
 *   `text-[22px]` — the hub-scale numeric readout, the largest type the
 *                   reference app uses anywhere.
 *   `text-[8px]`  — the verb inside the hub ring (`HUB_LABEL` in ui.tsx). The
 *                   ///M type scale has always had this "tiny tag / unit" step;
 *                   this checker simply did not, so the hub's verb sat at
 *                   LABEL's 10px inside a 72px circle.
 *
 * Naming them here is what stops either becoming "well, 18px is nearly the
 * same". Both live in ui.tsx — a call site that spells one out by hand still
 * trips HAND_LABEL below.
 */
const BAD_SIZE = /text-\[(?!8px|10px|11px|22px)\d+px\]/g;

/**
 * The label recipe. Written once, in `LABEL`. Six call sites had spelled it out
 * by hand and three of them had drifted to a different size.
 */
const HAND_LABEL = /font-bold uppercase tracking-widest/g;
const HAND_LABEL_FLAT = /font-bold uppercase tracking-widest/;
const CLASS_SPAN = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

/**
 * Outlines. `border-b` / `border-t` / `border-r` / `border-l` are RULES BETWEEN
 * REGIONS and always fine. A bare `border` or `border-2` is an OUTLINE AROUND A
 * THING, which the system does not have — except for the four documented cases,
 * which are listed by file so a fifth cannot be added quietly.
 */
const OUTLINE = /(?:^|[\s"'`{])border(?:-2)?(?![-\w])/g;
const OUTLINE_ALLOWED = new Set([
    // The canonical empty state's dashed ring lives in ui.tsx, alongside the
    // other primitives - a drop-target-style area, which the rule allows.
    'components/ui.tsx',
    // A drop zone genuinely is an area.
    'components/DropZone.tsx',
    // The floating surfaces: the write-confirm modal, the preview's first-run
    // notice, and the MODE sheet that opens from the hub panel's corner. All
    // three are detached from the page and need an edge.
    'components/ConfirmDialog.tsx',
    'components/PreviewNotice.tsx',
    'components/ModeCorner.tsx',
    // The hub ring is a STATE indicator, not a frame. Named here so a second
    // ring cannot appear without this list changing.
    'components/Hub.tsx',
]);

/** Row padding. One list, one row height. */
const BAD_PY = /\bpy-(?!0\.5\b|1\b|1\.5\b|2\b|3\b|4\b|5\b)[\w.[\]]+/g;

/**
 * A hand-rolled list.
 *
 * `divide-y` IS a list — it is what separates rows — so only `DataList` may own
 * it. This is the rule whose absence let the datalog channel picker stay a
 * `<details>` / `<summary>` / `<label>` tree with its own group headers, its own
 * count format and its own row height, sitting beside a jobs list that had a
 * search box and facet chips and none of which it shared. Two lists of a few
 * hundred rows doing the same job and looking nothing alike.
 */
const HAND_LIST = /divide-y/g;

/**
 * A nested scroller inside a pane that already scrolls.
 *
 * The wheel does nothing until the inner list bottoms out. The channel picker
 * was the only place in the app that did this, which is exactly why nobody
 * noticed it was wrong.
 */
const NESTED_SCROLL = /\bmax-h-\d+\b[^"'`]*\boverflow-(auto|y-auto|scroll)\b|\boverflow-(auto|y-auto|scroll)\b[^"'`]*\bmax-h-\d+\b/g;

/**
 * Every `<DataRow>` must name the thing it shows.
 *
 * The primary slot is for the HUMAN NAME. Eight of the app's ten row types once
 * had the SGBD identifier there instead — in the bright monospace slot that
 * never truncates — with the translated name demoted to the slot that truncates
 * first. `HumanName` makes that a type error; this makes the older spelling a
 * clearer one, and catches a `name` that was simply forgotten.
 *
 * Scans attribute text between `<DataRow` and the matching `>`, tracking `{}`
 * depth so a nested `<DataRow>` inside a `detail={...}` does not confuse it.
 */
function checkDataRows(text, relFile, startLine, fail) {
    for (const m of text.matchAll(/<DataRow\b/g)) {
        let depth = 0;
        let i = m.index + m[0].length;
        let attrs = '';
        for (; i < text.length; i++) {
            const ch = text[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            else if (ch === '>' && depth === 0) break;
            if (depth === 0) attrs += ch;
        }
        const at = startLine + text.slice(0, m.index).split('\n').length - 1;
        for (const dead of ['title', 'subtitle']) {
            if (new RegExp(`\\b${dead}\\s*=`).test(attrs)) {
                fail(relFile, at, `<DataRow ${dead}=> — renamed: name (HumanName) / ident / code. See ui.tsx DataRow.`);
            }
        }
        if (!/\bname\s*=/.test(attrs)) {
            fail(relFile, at, `<DataRow> without name= — every row must say what the thing is called`);
        }
    }
}

function* files(dir) {
    for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) yield* files(p);
        else if (/\.tsx?$/.test(name)) yield p;
    }
}

let failures = 0;
function fail(rel, line, msg) {
    console.error(`  ${rel}:${line}  ${msg}`);
    failures++;
}

for (const file of SCAN.flatMap((d) => [...files(d)])) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    const isUi = file === UI;
    const source = readFileSync(file, 'utf-8');
    const lines = source.split(/\r?\n/);

    if (!isUi) checkDataRows(source, rel, 1, fail);

    // Comments explain the rules; they must not trip them. `/* */` state is
    // tracked across lines because the rule docs are block comments, and a
    // docstring that says "never `border`" is not a violation of itself.
    let inBlock = false;

    lines.forEach((raw, i) => {
        const n = i + 1;
        let text = raw;
        if (inBlock) {
            const end = text.indexOf('*/');
            if (end === -1) return;
            text = text.slice(end + 2);
            inBlock = false;
        }
        const open = text.indexOf('/*');
        if (open !== -1) {
            const close = text.indexOf('*/', open + 2);
            if (close === -1) {
                inBlock = true;
                text = text.slice(0, open);
            } else {
                text = text.slice(0, open) + text.slice(close + 2);
            }
        }
        text = text.replace(/\/\/.*$/, '');
        if (!text.trim()) return;
        for (const m of text.matchAll(BAD_SIZE)) {
            fail(rel, n, `${m[0]} — the ramp is text-[10px] (label) and text-[11px] (data). See ui.tsx LABEL.`);
        }
        if (!isUi) {
            for (const m of text.matchAll(HAND_LABEL)) {
                void m;
                fail(rel, n, `hand-written label recipe — import LABEL or MicroLabel from ui.tsx`);
            }
        }
        if (!OUTLINE_ALLOWED.has(rel)) {
            for (const m of text.matchAll(OUTLINE)) {
                void m;
                fail(rel, n, `outline border — the system rules BETWEEN regions (border-b/-t/-l/-r) and never around a thing`);
            }
        }
        for (const m of text.matchAll(BAD_PY)) {
            fail(rel, n, `${m[0]} — row padding comes from DataRow; the allowed scale is py-0.5|1|1.5|2|3|4|5`);
        }
        if (!isUi) {
            for (const m of text.matchAll(HAND_LIST)) {
                void m;
                fail(rel, n, `hand-rolled list — divide-y belongs to DataList; use DataList/DataRow from ui.tsx`);
            }
        }
        for (const m of text.matchAll(NESTED_SCROLL)) {
            void m;
            fail(rel, n, `nested scroller — the pane already scrolls; a max-h + overflow inside it traps the wheel`);
        }
    });

    // A local that shadows a ui.tsx import. page.tsx had its own
    // `const LABEL: Record<StepId, string>` for tab names; once the file also
    // imported LABEL, five `${LABEL}` class strings rendered `[object Object]`
    // and every label in the hub lost its size, weight and case. tsc is happy
    // with an object in a template literal, so nothing else catches it.
    if (!isUi) {
        const imp = source.match(/import\s*\{([^}]*)\}\s*from\s*'@\/components\/ui'/);
        const names = imp ? imp[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean) : [];
        for (const name of names) {
            for (const m of source.matchAll(new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`, 'g'))) {
                fail(rel, source.slice(0, m.index).split('\n').length,
                    `local ${name} shadows the ui.tsx import of the same name`);
            }
        }
    }

    // The line scan above cannot see a recipe that a formatter wrapped:
    // `text-[10px] font-bold uppercase` / `tracking-widest` on the next line
    // passes it. Four of them did, in this repo. So a className that spans
    // lines is also read flattened.
    if (!isUi) {
        for (const m of source.matchAll(CLASS_SPAN)) {
            const body = m[1] ?? m[2];
            if (!body.includes('\n')) continue;
            if (HAND_LABEL_FLAT.test(body.split(/\s+/).join(' '))) {
                fail(rel, source.slice(0, m.index).split('\n').length,
                    `hand-written label recipe (wrapped across lines) — import LABEL or MicroLabel from ui.tsx`);
            }
        }
    }
}

/**
 * The allow-list, checked against reality.
 *
 * An exception is only an exception while the thing it excuses still exists.
 * `components/GateModal.tsx` sat in this list after that component was deleted —
 * harmless on its own, but a list nobody can trust is a list nobody reads before
 * adding to. So: every entry must name a file that exists AND that actually
 * carries an outline. Removing the last bare `border` from an allowed file fails
 * here, which is the moment to take it off the list.
 */
for (const rel of OUTLINE_ALLOWED) {
    let source;
    try {
        source = readFileSync(path.join(ROOT, rel), 'utf-8');
    } catch {
        fail('tools/check_ui_tokens.mjs', 0, `OUTLINE_ALLOWED names ${rel}, which does not exist`);
        continue;
    }
    const uses = source.split(/\r?\n/).some((l) => {
        const t = l.trim();
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
        OUTLINE.lastIndex = 0;
        return OUTLINE.test(l);
    });
    if (!uses) fail('tools/check_ui_tokens.mjs', 0, `OUTLINE_ALLOWED names ${rel}, which has no outline to allow`);
}

if (failures) {
    console.error(`\n[FAIL] ${failures} token violation(s).`);
    process.exit(1);
}
console.log('ok - ui tokens');
