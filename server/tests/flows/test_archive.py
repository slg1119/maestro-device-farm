import io
import stat
import zipfile

import pytest

from farm.flows.archive import UnsafeArchiveError, safe_extract_zip


def _zip(tmp_path, entries: dict[str, bytes], symlink: str | None = None):
    path = tmp_path / "in.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
        if symlink:
            info = zipfile.ZipInfo(symlink)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(info, "/etc/passwd")
    return path


def test_extracts_and_collapses_single_root(tmp_path):
    z = _zip(tmp_path, {".maestro/a.yaml": b"x", ".maestro/sub/b.yaml": b"y"})
    root = safe_extract_zip(z, tmp_path / "out", max_total_bytes=1000)
    assert root == tmp_path / "out" / ".maestro"
    assert (root / "sub" / "b.yaml").read_bytes() == b"y"


def test_flat_archive_root_is_dest(tmp_path):
    z = _zip(tmp_path, {"a.yaml": b"x", "b.yaml": b"y"})
    assert safe_extract_zip(z, tmp_path / "out", max_total_bytes=1000) == tmp_path / "out"


def test_macos_metadata_is_ignored(tmp_path):
    z = _zip(tmp_path, {"flows/a.yaml": b"x", "__MACOSX/flows/._a.yaml": b"junk"})
    root = safe_extract_zip(z, tmp_path / "out", max_total_bytes=1000)
    assert root == tmp_path / "out" / "flows"
    assert not (tmp_path / "out" / "__MACOSX").exists()


@pytest.mark.parametrize("name", ["../evil.yaml", "/abs.yaml", "a/../../evil.yaml", "C:/evil.yaml"])
def test_rejects_unsafe_paths(tmp_path, name):
    z = _zip(tmp_path, {name: b"x"})
    with pytest.raises(UnsafeArchiveError):
        safe_extract_zip(z, tmp_path / "out", max_total_bytes=1000)


def test_rejects_symlinks(tmp_path):
    z = _zip(tmp_path, {"a.yaml": b"x"}, symlink="link.yaml")
    with pytest.raises(UnsafeArchiveError):
        safe_extract_zip(z, tmp_path / "out", max_total_bytes=1000)


def test_rejects_oversized_content(tmp_path):
    z = _zip(tmp_path, {"a.yaml": b"x" * 2000})
    with pytest.raises(UnsafeArchiveError):
        safe_extract_zip(z, tmp_path / "out", max_total_bytes=1000)


def test_rejects_non_zip(tmp_path):
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"not a zip")
    with pytest.raises(UnsafeArchiveError):
        safe_extract_zip(bad, tmp_path / "out", max_total_bytes=1000)
