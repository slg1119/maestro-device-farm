import stat
import zipfile
from pathlib import Path, PurePosixPath

IGNORED_NAMES = {"__MACOSX", ".DS_Store"}


class UnsafeArchiveError(ValueError):
    pass


def _check_member(info: zipfile.ZipInfo) -> None:
    name = info.filename
    parts = PurePosixPath(name).parts
    if name.startswith(("/", "\\")) or "\\" in name or (len(name) > 1 and name[1] == ":") or ".." in parts:
        raise UnsafeArchiveError(f"unsafe path in archive: {name}")
    if stat.S_ISLNK(info.external_attr >> 16):
        raise UnsafeArchiveError(f"symlinks are not allowed: {name}")


def safe_extract_zip(zip_path: Path, dest: Path, max_total_bytes: int) -> Path:
    try:
        archive = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise UnsafeArchiveError("not a zip archive") from exc
    with archive:
        members = archive.infolist()
        total = 0
        for info in members:
            _check_member(info)
            total += info.file_size
            if total > max_total_bytes:
                raise UnsafeArchiveError("archive is too large once extracted")
        dest.mkdir(parents=True, exist_ok=True)
        for info in members:
            if IGNORED_NAMES & set(PurePosixPath(info.filename).parts):
                continue
            archive.extract(info, dest)
    return _collapse_single_dir(dest)


def _collapse_single_dir(root: Path) -> Path:
    entries = [entry for entry in root.iterdir() if entry.name not in IGNORED_NAMES]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return root
