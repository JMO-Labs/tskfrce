"""Shared QR helper: text -> inline SVG markup."""

import io

import segno


def qr_svg(text: str) -> str:
    buf = io.BytesIO()
    segno.make(text).save(buf, kind="svg", scale=6, border=2, xmldecl=False)
    return buf.getvalue().decode()
