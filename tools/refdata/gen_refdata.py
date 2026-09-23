# -*- coding: utf-8 -*-
"""
gen_refdata.py - build the reference data CODING and TEST read at run time, from inputs this
repository does not hold and must never hold (THIRD-PARTY-NOTICES.md 3.3).

  kombi-coding.json   every E46 cluster coding definition NCS Expert has (KMBE46M3.Cxx and
                      KMB_E46.Cxx): blocks, parameters with their addresses and masks, options
                      with their data - and a name for each keyword in Japanese and English,
                      with where the name came from
  kombi-names.json    per variant: the lamp, output and input bits TEST drives and reads, and
                      the fault locations, named in Japanese and English

The JSON is served to the app behind the owner gate (web/functions/api/ref) and is never
committed or bundled. This script is the only thing that knows how it is made.

INPUTS - environment variables. A missing one stops the run: a generator that "finds nothing"
and exits 0 looks exactly like one that passed.

  NCS_DATEN      NCS Expert's E46 folder             default C:\\NCSEXPER\\DATEN\\E46
  M35080_TERMS   the private terms, terms/m35080     required
  DIAG_TOOLS     E46M3-Diagnosis/tools (translate.py) default: ../E46M3-Diagnosis/tools beside this repo
  SGBD_DUMP_DIR  the SGBD dumps                       default C:\\EDIABAS-derived\\sgbd-dumps
  REFDATA_OUT    where the JSON goes                  default C:\\EDIABAS-derived\\m35080-refdata

  python tools/refdata/gen_refdata.py            write both files
  python tools/refdata/gen_refdata.py --check    compare with what is there: drift (exit 1),
                                                 and how much is translated, by source

NAMES
  authored   a person wrote it: terms/m35080 (or, for SGBD texts, the Diagnosis terms)
  heuristic  composed from the token dictionary, every token of it known
  raw        not translated; the keyword itself is shown
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import importlib.util
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cabd import parse, keyword_table  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCHEMA = 1
GENERATOR = 'tools/refdata/gen_refdata.py'

#: The cluster's coding definitions: the M3's own, and the rest of the E46 range.
DEFINITION_GLOBS = ('KMBE46M3.C*', 'KMB_E46.C*')
VARIANTS = ('KOMBI46', 'KOMBI46R')


# --------------------------------------------------------------------------- inputs


def _require(path: str, what: str) -> str:
    if not path or not os.path.exists(path):
        raise SystemExit(f'[FATAL] {what} not found: {path or "(unset)"}')
    return path


def inputs() -> dict:
    env = os.environ.get
    terms = env('M35080_TERMS')
    if not terms:
        raise SystemExit('[FATAL] M35080_TERMS is not set: point it at terms/m35080 in the private data repository.')
    return {
        'ncs': _require(env('NCS_DATEN') or r'C:\NCSEXPER\DATEN\E46', 'NCS Expert E46 folder (NCS_DATEN)'),
        'terms': _require(terms, 'terms/m35080 (M35080_TERMS)'),
        'diag': _require(env('DIAG_TOOLS') or os.path.join(REPO, '..', 'E46M3-Diagnosis', 'tools'), 'Diagnosis tools (DIAG_TOOLS)'),
        'dumps': _require(env('SGBD_DUMP_DIR') or r'C:\EDIABAS-derived\sgbd-dumps', 'SGBD dumps (SGBD_DUMP_DIR)'),
        'out': env('REFDATA_OUT') or r'C:\EDIABAS-derived\m35080-refdata',
    }


def sha256(path: str) -> str:
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def load_module(path: str, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def find(folder: str, pattern: str) -> str:
    """The one file matching `pattern`, case-insensitively (NCS ships .DAT and .dat)."""
    rx = re.compile(pattern.replace('.', r'\.').replace('*', '.*') + '$', re.I)
    hits = sorted(f for f in os.listdir(folder) if rx.match(f))
    if not hits:
        raise SystemExit(f'[FATAL] no {pattern} in {folder}')
    return os.path.join(folder, hits[-1])


# ---------------------------------------------------------------------------- names

_INDEXED = re.compile(r'^(.*)\[(\d+)\]$')


def split_index(keyword: str) -> tuple[str, str | None]:
    """'FAHRGESTELL_NR[11]' -> ('FAHRGESTELL_NR', '11'). A name without an index is itself."""
    m = _INDEXED.match(keyword)
    return (m.group(1), m.group(2)) if m else (keyword, None)


class Namer:
    """
    Names a keyword in Japanese and English, and says where the name came from.

    `phrases` are authored translations, looked up exactly (and by the base of an indexed name).
    `authored` looks up other authored sources - the Diagnosis terms for SGBD texts - and
    `compose` builds a heuristic name from tokens, or returns None when a token is unknown.
    """

    def __init__(
        self,
        phrases: dict[str, tuple[str, str]],
        authored: Callable[[str], tuple[str, str] | None] = lambda _k: None,
        compose: Callable[[str], tuple[str, str] | None] = lambda _k: None,
    ):
        self.phrases = phrases
        self.authored = authored
        self.compose = compose

    def __call__(self, keyword: str) -> dict:
        base, index = split_index(keyword)
        suffix = f' [{index}]' if index else ''
        hit = self.phrases.get(keyword) or self.phrases.get(base) or self.authored(keyword) or self.authored(base)
        source = 'authored'
        if not hit:
            hit = self.compose(base)
            source = 'heuristic'
        if not hit:
            return {'ja': None, 'en': None, 'source': 'raw'}
        return {'ja': hit[0] + suffix, 'en': hit[1] + suffix, 'source': source}


def diagnosis_translator(diag_tools: str, tokens: dict[str, tuple[str, str]]):
    """The Diagnosis token translator, with this project's tokens added."""
    sys.path.insert(0, diag_tools)
    import translate as T  # type: ignore

    for k, v in tokens.items():
        T.DICT.setdefault(k.upper(), tuple(v))
    T._MAXLEN = max(len(k) for k in T.DICT)

    def compose(text: str):
        if T.leftover_ratio(text, strip_prefixes=()) != 0.0:
            return None
        return (T.translate(text, 'ja', strip_prefixes=()), T.translate(text, 'en', strip_prefixes=()))

    def authored_for(sgbd: str):
        def look(text: str):
            if not T.authored(text, sgbd):
                return None
            return (T.translate(text, 'ja', sgbd=sgbd), T.translate(text, 'en', sgbd=sgbd))

        return look

    return compose, authored_for


# ----------------------------------------------------------------------- definitions

BLOCK_KINDS = {
    'CODIERDATENBLOCK': 'coding',
    'HERSTELLERDATENBLOCK': 'maker',
    'RESERVIERTDATENBLOCK': 'reserved',
}


def definition(buf: bytes, fsw_names: dict[int, str], psw_names: dict[int, str]) -> dict:
    """One coding definition as data. Options follow the FSW record they belong to."""
    out: dict = {'memory': None, 'codingIndex': None, 'blocks': [], 'parameters': [], 'unused': []}
    current: dict | None = None
    for name, f in parse(buf).data:
        if name in BLOCK_KINDS:
            out['blocks'].append({
                'kind': BLOCK_KINDS[name],
                'block': f['BLOCKNR'],
                'address': f['WORTADR'],
                'length': f['BYTEADR'],
                'name': f['BEZEICHNUNG'],
            })
        elif name == 'PARZUWEISUNG_FSW':
            current = {
                'kind': 'fsw',
                'keyword': fsw_names.get(f['FSW'], f"FSW_{f['FSW']:04X}"),
                'id': f['FSW'],
                'block': f['BLOCKNR'],
                'address': f['WORTADR'],
                'length': f['BYTEADR'],
                'index': f['INDEX'],
                'mask': f['MASKE'],
                'unit': f['EINHEIT'],
                'individual': f['INDIVID'],
                'options': [],
            }
            out['parameters'].append(current)
        elif name == 'PARZUWEISUNG_PSW1':
            if current is None:
                raise SystemExit('[FATAL] an option (PSW1) before any parameter (FSW)')
            current['options'].append({
                'keyword': psw_names.get(f['PSW'], f"PSW_{f['PSW']:04X}"),
                'id': f['PSW'],
                'data': f['DATUM'],
            })
        elif name == 'PARZUWEISUNG_DIR':
            current = None
            out['parameters'].append({
                'kind': 'dir',
                'keyword': fsw_names.get(f['FSW'], f"FSW_{f['FSW']:04X}"),
                'id': f['FSW'],
                'block': f['BLOCKNR'],
                'address': f['WORTADR'],
                'length': f['BYTEADR'],
                'index': f['INDEX'],
                'mask': f['MASKE'],
                'operations': f['OPERATION'],
                'unit': f['EINHEIT'],
            })
        elif name == 'UNBELEGT1':
            out['unused'].append({
                'block': f['BLOCKNR'],
                'address': f['WORTADR'],
                'length': f['BYTEADR'],
                'index': f['INDEX'],
                'mask': f['MASKE'],
            })
        elif name == 'SPEICHERORG':
            out['memory'] = {'structure': f['STRUKTUR'], 'type': f['TYP']}
        elif name == 'SGID_CODIERINDEX':
            out['codingIndex'] = f
        elif name == 'ANLIEFERZUSTAND':
            out['delivery'] = f['WERT']
    return out


def coding(inp: dict, namer: Namer) -> tuple[dict, dict]:
    ncs = inp['ncs']
    fsw_path, psw_path = find(ncs, 'SWTFSW*.DAT'), find(ncs, 'SWTPSW*.DAT')
    fsw_names = keyword_table(open(fsw_path, 'rb').read())
    psw_names = keyword_table(open(psw_path, 'rb').read())

    files = sorted({f for g in DEFINITION_GLOBS for f in glob.glob(os.path.join(ncs, g))})
    if not files:
        raise SystemExit(f'[FATAL] no cluster coding definitions in {ncs}')
    definitions = {}
    sources = {}
    for f in files:
        definitions[os.path.basename(f)] = definition(open(f, 'rb').read(), fsw_names, psw_names)
        sources[os.path.basename(f)] = sha256(f)
    sources[os.path.basename(fsw_path)] = sha256(fsw_path)
    sources[os.path.basename(psw_path)] = sha256(psw_path)

    groups: dict[str, set[str]] = {'fsw': set(), 'dir': set(), 'psw': set(), 'block': set()}
    for d in definitions.values():
        for b in d['blocks']:
            groups['block'].add(b['name'])
        for p in d['parameters']:
            groups[p['kind']].add(p['keyword'])
            for o in p.get('options', []):
                groups['psw'].add(o['keyword'])
    names = {g: {k: namer(k) for k in sorted(ks)} for g, ks in groups.items()}
    return {'definitions': definitions, 'names': names}, sources


# ----------------------------------------------------------------------------- names file

_BIT = re.compile(r'^Bit\s*(\d)\s*:\s*(.+)$', re.I)


def arg_bits(comment: str) -> dict[int, str]:
    """'Belegung ... / Bit0: RDKS Rot / Bit1: frei' -> {0: 'RDKS Rot'}. Free and reserve bits are not names."""
    out = {}
    for part in (comment or '').split('/'):
        m = _BIT.match(part.strip())
        if m and not re.match(r'^(frei\d*|reserve\d*)$', m.group(2).strip(), re.I):
            out[int(m.group(1))] = m.group(2).strip()
    return out


def names_file(inp: dict, bits_terms, namer_for: Callable[[str], Namer]) -> tuple[dict, dict]:
    variants = {}
    sources = {}
    for v in VARIANTS:
        path = os.path.join(inp['dumps'], f'{v}.json')
        dump = json.load(io.open(_require(path, f'{v} dump'), encoding='utf-8'))
        sources[f'{v}.json'] = sha256(path)
        jobs = {j['job']: j for j in dump['jobs']}
        name = namer_for(v)
        lamps = {}
        for i, arg in enumerate(jobs['STEUERN_LEUCHTE']['args']):
            for bit, text in arg_bits(arg.get('comment', '')).items():
                lamps[f'B{i + 1}.b{bit}'] = {'sgbd': text, **name(text)}
        outputs = {}
        if 'STEUERN_IO' in jobs:
            for bit, text in arg_bits(jobs['STEUERN_IO']['args'][0].get('comment', '')).items():
                outputs[f'P6.b{bit}'] = {'sgbd': text, **name(text)}
        inputs = {key: {'sgbd': result, **name(result)} for key, result in bits_terms.INPUTS[v].items()}
        faults = {}
        for code, text in dump['tables']['FORTTEXTE'][1:]:
            faults[code] = {'sgbd': text, **name(text)}
        variants[v] = {'lamps': lamps, 'outputs': outputs, 'inputs': inputs, 'faults': faults}
    return {'variants': variants}, sources


# ------------------------------------------------------------------------------ output

def coverage(named: dict) -> dict:
    """{group: {authored, heuristic, raw}} over every name entry below `named`."""
    out = {}
    for group, entries in named.items():
        counts = {'authored': 0, 'heuristic': 0, 'raw': 0}
        for e in entries.values():
            counts[e['source']] += 1
        out[group] = counts
    return out


def document(kind: str, body: dict, sources: dict, terms: dict, cover: dict) -> dict:
    return {
        'schema': SCHEMA,
        'kind': kind,
        'generator': GENERATOR,
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'sources': dict(sorted(sources.items())),
        'terms': terms,
        'coverage': cover,
        **body,
    }


def dumps(doc: dict) -> str:
    # Compact: it travels to the browser every session and is never read as a diff.
    return json.dumps(doc, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n'


def comparable(text: str) -> dict:
    """A written file without its timestamp: what --check compares."""
    d = json.loads(text)
    d.pop('generatedAt', None)
    return d


def build(inp: dict) -> dict[str, dict]:
    ncs_terms = load_module(os.path.join(inp['terms'], 'ncs_kombi.py'), 'm35080_ncs_kombi')
    bits_terms = load_module(os.path.join(inp['terms'], 'kombi_bits.py'), 'm35080_kombi_bits')
    compose, authored_for = diagnosis_translator(inp['diag'], ncs_terms.TOKENS)
    terms = {
        'ncs_kombi.py': sha256(os.path.join(inp['terms'], 'ncs_kombi.py')),
        'kombi_bits.py': sha256(os.path.join(inp['terms'], 'kombi_bits.py')),
    }

    body, sources = coding(inp, Namer(ncs_terms.PHRASES, compose=compose))
    coding_doc = document('kombi-coding', body, sources, terms, coverage(body['names']))

    body, sources = names_file(
        inp, bits_terms, lambda sgbd: Namer(bits_terms.PHRASES, authored=authored_for(sgbd), compose=compose)
    )
    per_group = {}
    for v, groups in body['variants'].items():
        for g, entries in groups.items():
            per_group[f'{v}.{g}'] = entries
    names_doc = document('kombi-names', body, sources, terms, coverage(per_group))
    return {'kombi-coding.json': coding_doc, 'kombi-names.json': names_doc}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='compare with the files already written; exit 1 on drift')
    args = ap.parse_args(argv)
    inp = inputs()
    docs = build(inp)

    for name, doc in docs.items():
        cover = doc['coverage']
        total = {k: sum(c[k] for c in cover.values()) for k in ('authored', 'heuristic', 'raw')}
        print(f'{name}: authored {total["authored"]}, heuristic {total["heuristic"]}, raw {total["raw"]}')
        for group, c in cover.items():
            print(f'  {group:<22} authored {c["authored"]:>4}  heuristic {c["heuristic"]:>4}  raw {c["raw"]:>4}')

    if args.check:
        drift = []
        for name, doc in docs.items():
            path = os.path.join(inp['out'], name)
            if not os.path.exists(path):
                drift.append(f'missing   {path}')
            elif comparable(open(path, encoding='utf-8').read()) != comparable(dumps(doc)):
                drift.append(f'differs   {path}')
        for d in drift:
            print(d)
        print('refdata: up to date' if not drift else 'refdata: DRIFT - run without --check to regenerate')
        return 1 if drift else 0

    os.makedirs(inp['out'], exist_ok=True)
    for name, doc in docs.items():
        with open(os.path.join(inp['out'], name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(dumps(doc))
        print(f'wrote {os.path.join(inp["out"], name)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
