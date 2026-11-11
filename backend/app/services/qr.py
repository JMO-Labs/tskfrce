"""Shared QR helper: text -> inline SVG markup."""

import io


def qr_svg(text: str) -> str:
    import segno  # lazy: small boxes skip it until a QR is shown

    buf = io.BytesIO()
    segno.make(text).save(buf, kind="svg", scale=6, border=2, xmldecl=False)
    return buf.getvalue().decode()
