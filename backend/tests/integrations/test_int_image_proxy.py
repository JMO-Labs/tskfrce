import time

import pytest
from app.integrations import widget_service
from app.models.integration import IntegrationKid
from tests.integrations.int_helpers import IMG_URL, img_path

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF_BYTES = b"GIF89a" + b"\x00" * 32
WEBP_BYTES = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32


def test_serves_allowed_png(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    r = client.get(img_path(widget_with_image), headers=parent_headers)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff" and "cookie" not in cdn.last_headers
    assert "referer" not in cdn.last_headers


def test_url_not_in_widgets_is_404(client, parent_headers, widget_with_image):
    assert (
        client.get(
            f"/api/v1/integration-widgets/{widget_with_image.id}/image?u=https%3A%2F%2Fevil.example%2Fx.png",
            headers=parent_headers,
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "ctype,body",
    [
        ("image/svg+xml", b"<svg/>"),
        ("text/html", b"<html>"),
        ("image/png", b"<html>not png"),
    ],
)
def test_non_images_refused(client, parent_headers, widget_with_image, cdn, ctype, body):
    cdn.serve(body, ctype)
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502


def test_over_one_mb_refused(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES + b"0" * 1_048_576, "image/png")
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502


def test_private_image_host_refused(client, parent_headers, widget_with_image, resolve_to):
    resolve_to("192.168.1.10")
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502


def test_kid_without_widgets_404(client, kid_headers, widget_with_image):
    assert client.get(img_path(widget_with_image), headers=kid_headers).status_code == 404


# --- beyond the brief ---


def test_response_headers_are_ours_only(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png; charset=binary")
    r = client.get(img_path(widget_with_image), headers=parent_headers)
    assert r.status_code == 200 and r.content == PNG_BYTES
    assert r.headers["content-security-policy"] == "default-src 'none'"
    assert r.headers["cache-control"] == "private, max-age=300"
    assert "set-cookie" not in r.headers and "x-upstream" not in r.headers
    assert cdn.last_headers["user-agent"] == "t@sk4ce-box/1"


@pytest.mark.parametrize(
    "ctype,body",
    [("image/jpeg", JPEG_BYTES), ("image/gif", GIF_BYTES), ("image/webp", WEBP_BYTES)],
)
def test_other_allowed_types(client, parent_headers, widget_with_image, cdn, ctype, body):
    cdn.serve(body, ctype)
    r = client.get(img_path(widget_with_image), headers=parent_headers)
    assert r.status_code == 200 and r.headers["content-type"] == ctype


@pytest.mark.parametrize(
    "ctype,body",
    [
        ("image/png", GIF_BYTES),  # header and magic disagree
        ("image/svg+xml", PNG_BYTES),  # svg header even with png bytes
        ("", PNG_BYTES),  # no content type
        ("image/webp", b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 8),
    ],
)
def test_header_and_magic_must_agree(client, parent_headers, widget_with_image, cdn, ctype, body):
    cdn.serve(body, ctype)
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502


def test_inactive_install_404(client, db, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    widget_with_image.status = "paused"
    db.commit()
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 404
    assert cdn.calls == 0


def test_unknown_install_404(client, parent_headers, widget_with_image):
    path = img_path(widget_with_image).replace(f"/{widget_with_image.id}/", "/99999/")
    assert client.get(path, headers=parent_headers).status_code == 404


def test_needs_auth(client, widget_with_image):
    assert client.get(img_path(widget_with_image)).status_code == 401


def test_expired_widget_cache_404(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    widget_service._cache.clear()
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 404


def _kid_cache(install_id, kid_id, urls):
    widget_service._cache[(install_id, "kid", kid_id)] = (time.time() + 60, [], set(urls))


def _kid_widgets_on(db, install, kid_id):
    row = db.query(IntegrationKid).filter_by(install_id=install.id, kid_id=kid_id).one_or_none()
    if row is None:
        row = IntegrationKid(install_id=install.id, kid_id=kid_id)
        db.add(row)
    row.kid_widgets = True
    db.commit()


def test_kid_gets_images_from_own_kid_widgets(client, db, kid, kid_headers, install, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    _kid_widgets_on(db, install, kid.id)
    _kid_cache(install.id, kid.id, [IMG_URL])
    assert client.get(img_path(install), headers=kid_headers).status_code == 200


def test_kid_cannot_use_parent_widget_images(client, db, kid, kid_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    _kid_widgets_on(db, widget_with_image, kid.id)
    _kid_cache(widget_with_image.id, kid.id, [])
    assert client.get(img_path(widget_with_image), headers=kid_headers).status_code == 404


def test_kid_cannot_use_other_kids_images(client, db, kid, other_kid, kid_headers, install, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    _kid_widgets_on(db, install, kid.id)
    _kid_widgets_on(db, install, other_kid.id)
    _kid_cache(install.id, other_kid.id, [IMG_URL])
    assert client.get(img_path(install), headers=kid_headers).status_code == 404


def test_kid_without_kid_widgets_flag_404(client, db, kid, kid_headers, install, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    _kid_cache(install.id, kid.id, [IMG_URL])  # linked kid, but kid_widgets is off
    assert client.get(img_path(install), headers=kid_headers).status_code == 404


def test_repeat_served_from_memory(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    for _ in range(2):
        assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 200
    assert cdn.calls == 1


def test_lru_bounded_by_entries_and_bytes(monkeypatch):
    big = b"\x89PNG" + b"\x00" * (1_048_576 - 4)
    monkeypatch.setattr(widget_service, "fetch_image", lambda url: ("image/png", big))
    for i in range(40):
        widget_service.image(f"https://cdn.example/{i}.png")
    assert len(widget_service._images) <= 16
    assert sum(len(v[2]) for v in widget_service._images.values()) <= 16 * 1_048_576
    assert "https://cdn.example/39.png" in widget_service._images

    small = PNG_BYTES
    monkeypatch.setattr(widget_service, "fetch_image", lambda url: ("image/png", small))
    widget_service._images.clear()
    for i in range(40):
        widget_service.image(f"https://cdn.example/s{i}.png")
    assert len(widget_service._images) == 32
    assert "https://cdn.example/s0.png" not in widget_service._images


def test_failed_fetch_not_cached(client, parent_headers, widget_with_image, cdn):
    cdn.serve(b"<svg/>", "image/svg+xml")
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502
    assert widget_service._images == {}
