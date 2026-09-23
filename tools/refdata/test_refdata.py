# -*- coding: utf-8 -*-
"""
Unit tests for the CABD reader and the reference-data generator, on SYNTHETIC records.

Nothing here is read from NCS Expert. The keyword names, ids, addresses and texts are invented;
the only real strings are the schema keywords (PARZUWEISUNG_FSW ...) and their format strings,
which are the format itself.

  python -m unittest discover -s tools/refdata
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from functools import reduce

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cabd import CabdError, decode_fields, keyword_table, parse, records  # noqa: E402
from gen_refdata import Namer, arg_bits, comparable, coverage, definition, dumps, split_index  # noqa: E402


# ------------------------------------------------------------------ a synthetic CABD file

def rec(rtype: int, body: bytes) -> bytes:
    head = bytes([len(body), rtype & 0xFF, rtype >> 8]) + body
    return head + bytes([reduce(lambda a, b: a ^ b, head, 0)])


def schema(kid: int, name: str, fmt: str, args: str) -> bytes:
    return (
        rec(0x0300, kid.to_bytes(2, 'little') + name.encode() + b'\x00')
        + rec(0x0400, fmt.encode() + b'\x00')
        + rec(0x0500, args.encode() + b'\x00')
    )


def u16(v: int) -> bytes:
    return v.to_bytes(2, 'little')


def u32(v: int) -> bytes:
    return v.to_bytes(4, 'little')


def lst(items: list[int]) -> bytes:
    return u16(len(items)) + bytes(items)


HEADER = rec(0x0100, b'\x00\x01') + rec(0x0200, b'\x02')

DEFINITION_SCHEMA = (
    schema(0x06, 'CODIERDATENBLOCK', '{L}LWS', 'BLOCKNR,WORTADR,BYTEADR,BEZEICHNUNG')
    + schema(0x10, 'PARZUWEISUNG_PSW1', 'W(B)', 'PSW,DATUM')
    + schema(0x11, 'PARZUWEISUNG_DIR', '{L}LWW{B}(B)(A)B', 'BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,OPERATION,EINHEIT')
    + schema(0x12, 'PARZUWEISUNG_FSW', '{L}LWW{B}(B){B}{B}', 'BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID')
    + schema(0x04, 'SPEICHERORG', 'SS', 'STRUKTUR,TYP')
    + rec(0xFF00, b'')
)


def fsw(address: int, length: int, fid: int, mask: list[int]) -> bytes:
    return rec(0x12, b'\x00' + u32(address) + u16(length) + u16(fid) + b'\x00' + lst(mask) + b'\x00' + b'\x00')


def psw(pid: int, data: list[int]) -> bytes:
    return rec(0x10, u16(pid) + lst(data))


def synthetic_definition() -> bytes:
    return (
        HEADER
        + DEFINITION_SCHEMA
        + rec(0x04, b'WORDMSB\x00TEST\x00')
        + rec(0x06, b'\x01' + u32(7) + u32(0x0100) + u16(0x20) + b'Demo_Block\x00')
        + fsw(0x0102, 1, 0x0A01, [0x30])
        + psw(0x0B01, [0x00])
        + psw(0x0B02, [0x10])
        + rec(0x11, b'\x00' + u32(0x0110) + u16(2) + u16(0x0A02) + b'\x00' + lst([0xFF, 0xFF]) + u16(1) + bytes(6) + b'\x05')
    )


# ------------------------------------------------------------------------------ the reader

class ReaderTest(unittest.TestCase):
    def test_a_checksum_covers_the_whole_record(self):
        buf = bytearray(synthetic_definition())
        self.assertGreater(len(records(bytes(buf))), 0)
        buf[5] ^= 0x01  # a byte of the first record's body
        with self.assertRaises(CabdError) as e:
            records(bytes(buf))
        self.assertEqual(e.exception.code, 'checksum')
        self.assertEqual(e.exception.offset, 0)

    def test_reads_each_record_by_its_own_keyword_format(self):
        c = parse(synthetic_definition())
        names = [n for n, _ in c.data]
        self.assertEqual(names, ['SPEICHERORG', 'CODIERDATENBLOCK', 'PARZUWEISUNG_FSW', 'PARZUWEISUNG_PSW1', 'PARZUWEISUNG_PSW1', 'PARZUWEISUNG_DIR'])
        block = c.data[1][1]
        self.assertEqual(block, {'BLOCKNR': 7, 'WORTADR': 0x0100, 'BYTEADR': 0x20, 'BEZEICHNUNG': 'Demo_Block'})
        direct = c.data[5][1]
        self.assertEqual(direct['OPERATION'], ['000000000000'])  # a 6-byte operation, kept opaque
        self.assertEqual(direct['INDEX'], None)                   # {B} absent
        self.assertEqual(direct['MASKE'], [0xFF, 0xFF])

    def test_refuses_a_body_its_format_does_not_consume_exactly(self):
        with self.assertRaises(CabdError) as e:
            decode_fields('WB', ['A', 'B'], b'\x01\x02\x03\x04', offset=0x40)
        self.assertEqual((e.exception.code, e.exception.offset), ('format', 0x40))
        with self.assertRaises(CabdError):
            decode_fields('W(B)', ['PSW', 'DATUM'], u16(1) + u16(3) + b'\x00', offset=0)

    def test_refuses_data_before_the_end_of_the_schema_and_unknown_keywords(self):
        with self.assertRaises(CabdError) as e:
            parse(HEADER + rec(0x0300, u16(1) + b'X\x00'))
        self.assertEqual(e.exception.code, 'schema')
        with self.assertRaises(CabdError) as e:
            parse(HEADER + DEFINITION_SCHEMA + rec(0x77, b''))
        self.assertEqual(e.exception.code, 'keyword')

    def test_reads_a_keyword_table(self):
        table = (
            HEADER
            + schema(0x01, 'SWT_EINTRAG', 'WS', 'KEYID,KEYWORD')
            + rec(0xFF00, b'')
            + rec(0x01, u16(0x0A01) + b'DEMO_PARAMETER\x00')
            + rec(0x01, u16(0x0B01) + b'demo_option\x00')
        )
        self.assertEqual(keyword_table(table), {0x0A01: 'DEMO_PARAMETER', 0x0B01: 'demo_option'})


# --------------------------------------------------------------------------- the generator

class GeneratorTest(unittest.TestCase):
    def test_a_parameter_carries_the_options_that_follow_it(self):
        d = definition(synthetic_definition(), {0x0A01: 'DEMO_PARAMETER', 0x0A02: 'DEMO_DIRECT[3]'}, {0x0B01: 'aus', 0x0B02: 'an'})
        self.assertEqual(d['memory'], {'structure': 'WORDMSB', 'type': 'TEST'})
        self.assertEqual(d['blocks'], [{'kind': 'coding', 'block': 7, 'address': 0x0100, 'length': 0x20, 'name': 'Demo_Block'}])
        p, direct = d['parameters']
        self.assertEqual((p['kind'], p['keyword'], p['address'], p['mask']), ('fsw', 'DEMO_PARAMETER', 0x0102, [0x30]))
        self.assertEqual([(o['keyword'], o['data']) for o in p['options']], [('aus', [0x00]), ('an', [0x10])])
        self.assertEqual((direct['kind'], direct['keyword'], direct['unit']), ('dir', 'DEMO_DIRECT[3]', 5))

    def test_an_unknown_id_keeps_its_number(self):
        d = definition(synthetic_definition(), {}, {})
        self.assertEqual(d['parameters'][0]['keyword'], 'FSW_0A01')
        self.assertEqual(d['parameters'][0]['options'][0]['keyword'], 'PSW_0B01')

    def test_names_say_where_they_came_from(self):
        namer = Namer(
            {'DEMO': ('デモ', 'Demo'), 'LIST': ('一覧', 'List')},
            authored=lambda k: ('他', 'Other') if k == 'ELSEWHERE' else None,
            compose=lambda k: ('組', 'Composed') if k == 'TOKENS_ONLY' else None,
        )
        self.assertEqual(namer('DEMO'), {'ja': 'デモ', 'en': 'Demo', 'source': 'authored'})
        self.assertEqual(namer('LIST[4]'), {'ja': '一覧 [4]', 'en': 'List [4]', 'source': 'authored'})
        self.assertEqual(namer('ELSEWHERE')['source'], 'authored')
        self.assertEqual(namer('TOKENS_ONLY'), {'ja': '組', 'en': 'Composed', 'source': 'heuristic'})
        self.assertEqual(namer('UNKNOWN'), {'ja': None, 'en': None, 'source': 'raw'})
        self.assertEqual(split_index('NAME[11]'), ('NAME', '11'))
        self.assertEqual(split_index('NAME'), ('NAME', None))

    def test_reads_bit_names_out_of_an_argument_comment_and_skips_free_ones(self):
        comment = 'Belegung: (0-0xFF) / Bit0: Lampe A / Bit1: frei / Bit2: Lampe C / Bit7: Reserve1'
        self.assertEqual(arg_bits(comment), {0: 'Lampe A', 2: 'Lampe C'})

    def test_counts_names_by_source(self):
        named = {'g': {'a': {'source': 'authored'}, 'b': {'source': 'raw'}, 'c': {'source': 'raw'}}}
        self.assertEqual(coverage(named), {'g': {'authored': 1, 'heuristic': 0, 'raw': 2}})

    def test_the_check_ignores_only_the_timestamp(self):
        a = dumps({'generatedAt': '2026-01-01T00:00:00Z', 'x': [1, 2]})
        b = dumps({'generatedAt': '2026-09-24T00:00:00Z', 'x': [1, 2]})
        c = dumps({'generatedAt': '2026-09-24T00:00:00Z', 'x': [1, 3]})
        self.assertEqual(comparable(a), comparable(b))
        self.assertNotEqual(comparable(a), comparable(c))
        self.assertEqual(json.loads(a)['x'], [1, 2])


if __name__ == '__main__':
    unittest.main()
