from pathlib import Path

from fastapi import UploadFile

MB = 1024 * 1024
CHUNK = 1024 * 1024


class UploadTooLarge(Exception):
    pass


def save_upload(upload: UploadFile, dest: Path, max_bytes: int) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with dest.open("wb") as out:
        while chunk := upload.file.read(CHUNK):
            written += len(chunk)
            if written > max_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise UploadTooLarge(f"{upload.filename} is larger than {max_bytes // MB} MB")
            out.write(chunk)
    return dest
