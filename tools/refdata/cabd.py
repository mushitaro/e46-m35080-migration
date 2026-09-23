# -*- coding: utf-8 -*-
"""
cabd.py - read NCS Expert's CABD files: coding definitions (*.Cxx) and keyword tables (SWT*.DAT).

This file is code, and public. What it reads is not: the NCS files are BMW's, they stay where
NCS Expert installed them, and nothing read from them is committed (THIRD-PARTY-NOTICES.md 3.3).

THE FORMAT (measured on the E46 KOMBI files and keyword tables: every record's checksum holds,
every body is consumed exactly by its keyword's format)

  record   [len u8][type u16 LE][body: len bytes][xor u8]
           xor is over the whole record before it - len, type and body.

  header   0x0100 file header, 0x0200 version
  schema   0x0300 a keyword: id u16 LE, name (NUL-terminated)
           0x0400 that keyword's format string
           0x0500 that keyword's argument names, comma-separated
           0xFF00 ends the schema
  data     every later record's type is a keyword id; its body holds that keyword's arguments,
           laid out by its format:
             L  u32 LE     W  u16 LE     B  u8     S  NUL-terminated string (latin-1)
             A  a 6-byte operation, kept opaque
             {X}  optional: a flag byte, then X only when the flag is non-zero
             (X)  repeated: a u16 LE count, then X that many times

A record that does not fit - a bad checksum, a body its format does not consume exactly - is a
failure with its byte offset, never a guess (tsunagi-m-link section 9).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import reduce

HEADER = 0x0100
VERSION = 0x0200
KEYWORD = 0x0300
FORMAT = 0x0400
ARGS = 0x0500
END_SCHEMA = 0xFF00

#: The operation field of a direct parameter (A). Its meaning is not needed to code a cluster, so
#: it is carried as bytes.
OPERATION_BYTES = 6


class CabdError(ValueError):
    """A file this reader will not interpret: `code` names why, `offset` where."""

    def __init__(self, code: str, offset: int, detail: str = ""):
        super().__init__(f"{code} at 0x{offset:X}{': ' + detail if detail else ''}")
        self.code = code
        self.offset = offset


@dataclass
class Keyword:
    id: int
    name: str
    format: str = ""
    args: list[str] = field(default_factory=list)


@dataclass
class Record:
    offset: int
    type: int
    body: bytes


@dataclass
class Cabd:
    keywords: dict[int, Keyword]
    #: Data records, in file order: (keyword name, {argument: value}).
    data: list[tuple[str, dict]]


def records(buf: bytes) -> list[Record]:
    """Every record, its checksum verified."""
    out: list[Record] = []
    i = 0
    while i < len(buf):
        if i + 3 > len(buf):
            raise CabdError("truncated", i, "record header")
        n = buf[i]
        end = i + 3 + n
        if end >= len(buf):
            raise CabdError("truncated", i, f"record of {n} bytes")
        want = reduce(lambda a, b: a ^ b, buf[i:end], 0)
        if buf[end] != want:
            raise CabdError("checksum", i, f"0x{buf[end]:02X} != 0x{want:02X}")
        out.append(Record(i, buf[i + 1] | (buf[i + 2] << 8), bytes(buf[i + 3:end])))
        i = end + 1
    return out


def _tokens(fmt: str) -> list[tuple[str, str]]:
    """'{L}LW(B)' -> [('{','L'), ('','L'), ('','W'), ('(','B')]."""
    out, i = [], 0
    while i < len(fmt):
        c = fmt[i]
        if c in "{(":
            close = "}" if c == "{" else ")"
            j = fmt.index(close, i)
            out.append((c, fmt[i + 1:j]))
            i = j + 1
        else:
            out.append(("", c))
            i += 1
    return out


def _scalar(ch: str, b: bytes, p: int):
    if ch == "B":
        return b[p], p + 1
    if ch == "W":
        return b[p] | (b[p + 1] << 8), p + 2
    if ch == "L":
        return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24), p + 4
    if ch == "S":
        z = b.index(0, p)
        return b[p:z].decode("latin-1"), z + 1
    if ch == "A":
        return b[p:p + OPERATION_BYTES].hex(), p + OPERATION_BYTES
    raise ValueError(f"unknown format letter {ch!r}")


def decode_fields(fmt: str, args: list[str], body: bytes, offset: int = 0) -> dict:
    """A record body as {argument: value}. An optional absent argument is None; a repeated one a list."""
    values: list = []
    p = 0
    try:
        for kind, inner in _tokens(fmt):
            if kind == "{":
                flag = body[p]
                p += 1
                if flag:
                    for ch in inner:
                        v, p = _scalar(ch, body, p)
                        values.append(v)
                else:
                    values.extend([None] * len(inner))
            elif kind == "(":
                count = body[p] | (body[p + 1] << 8)
                p += 2
                items = []
                for _ in range(count):
                    for ch in inner:
                        v, p = _scalar(ch, body, p)
                        items.append(v)
                values.append(items)
            else:
                v, p = _scalar(inner, body, p)
                values.append(v)
    except (IndexError, ValueError) as e:
        raise CabdError("format", offset, f"{fmt}: {e}") from None
    if p != len(body):
        raise CabdError("format", offset, f"{fmt} consumed {p} of {len(body)} bytes")
    if len(values) != len(args):
        raise CabdError("format", offset, f"{len(values)} values for {len(args)} arguments")
    return dict(zip(args, values))


def parse(buf: bytes) -> Cabd:
    """The schema and every data record, decoded by its own keyword's format."""
    recs = records(buf)
    keywords: dict[int, Keyword] = {}
    current: Keyword | None = None
    data: list[tuple[str, dict]] = []
    in_schema = True
    for r in recs:
        if in_schema:
            if r.type in (HEADER, VERSION):
                continue
            if r.type == KEYWORD:
                kid = r.body[0] | (r.body[1] << 8)
                current = Keyword(kid, r.body[2:r.body.index(0, 2)].decode("latin-1"))
                keywords[kid] = current
            elif r.type == FORMAT and current:
                current.format = r.body[: r.body.index(0)].decode("latin-1")
            elif r.type == ARGS and current:
                text = r.body[: r.body.index(0)].decode("latin-1")
                current.args = [a for a in text.split(",") if a]
            elif r.type == END_SCHEMA:
                in_schema = False
            else:
                raise CabdError("schema", r.offset, f"record type 0x{r.type:04X}")
            continue
        kw = keywords.get(r.type)
        if kw is None:
            raise CabdError("keyword", r.offset, f"no keyword 0x{r.type:04X}")
        data.append((kw.name, decode_fields(kw.format, kw.args, r.body, r.offset)))
    if in_schema:
        raise CabdError("schema", len(buf), "no end of schema")
    return Cabd(keywords, data)


def keyword_table(buf: bytes) -> dict[int, str]:
    """An SWT keyword table (SWT_EINTRAG: KEYID, KEYWORD) as {id: name}."""
    table: dict[int, str] = {}
    for name, fields in parse(buf).data:
        if name == "SWT_EINTRAG":
            table[fields["KEYID"]] = fields["KEYWORD"]
    return table
