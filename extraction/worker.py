"""Local, provider-neutral OCR worker. One JSON request in; one JSON result out."""

from contextlib import redirect_stdout
import csv
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageOps, UnidentifiedImageError

VERSION = 1
MAX_REQUEST_BYTES = 65536
MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
MAX_PIXELS = 30_000_000
ALLOWED_MEDIA = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
CARD_PATTERN = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def safe_ocr_text(value: str) -> str:
    return CARD_PATTERN.sub("[REDACTED_CARD]", value)


class WorkerFailure(Exception):
    def __init__(self, code: str, retryable: bool = False):
        self.code = code
        self.retryable = retryable


def validate_request(request: object, allowed_root: Path) -> tuple[str, str, list[dict]]:
    if not isinstance(request, dict) or request.get("version") != VERSION:
        raise WorkerFailure("INVALID_REQUEST")
    engine = request.get("engine")
    device = request.get("device", "cpu")
    sources = request.get("sources")
    if engine not in ("paddle", "tesseract") or device not in ("cpu", "gpu"):
        raise WorkerFailure("INVALID_REQUEST")
    if engine == "tesseract" and device != "cpu":
        raise WorkerFailure("UNSUPPORTED_DEVICE")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 20:
        raise WorkerFailure("INVALID_REQUEST")
    validated = []
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("id"), str) or not source["id"]:
            raise WorkerFailure("INVALID_REQUEST")
        if source["id"] in seen or source.get("mediaType") not in ALLOWED_MEDIA:
            raise WorkerFailure("INVALID_REQUEST")
        seen.add(source["id"])
        path = source.get("path")
        if not isinstance(path, str):
            raise WorkerFailure("INVALID_REQUEST")
        resolved = Path(path).resolve()
        if allowed_root not in resolved.parents or not resolved.is_file():
            raise WorkerFailure("SOURCE_UNAVAILABLE")
        if resolved.stat().st_size > MAX_SOURCE_BYTES or resolved.stat().st_size == 0:
            raise WorkerFailure("SOURCE_INVALID")
        validated.append({"id": source["id"], "mediaType": source["mediaType"], "path": resolved})
    return engine, device, validated


def pages_for_source(source: dict):
    if source["mediaType"] == "application/pdf":
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / "page"
            try:
                subprocess.run(["pdftoppm", "-f", "1", "-l", str(MAX_PAGES + 1),
                                "-r", "150", "-png", str(source["path"]), str(prefix)],
                               check=True, capture_output=True, timeout=60)
            except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
                raise WorkerFailure("SOURCE_UNREADABLE") from None
            files = sorted(Path(directory).glob("page-*.png"),
                           key=lambda file: int(file.stem.split("-")[-1]))
            if not files or len(files) > MAX_PAGES:
                raise WorkerFailure("PAGE_LIMIT")
            for index, file in enumerate(files):
                yield index, file
    else:
        yield 0, source["path"]


def image_size(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            if width * height > MAX_PIXELS or width < 1 or height < 1:
                raise WorkerFailure("SOURCE_INVALID")
            return width, height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise WorkerFailure("SOURCE_UNREADABLE") from None


def receipt_crop(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Find a light receipt against a darker photo background, conservatively."""
    width, height = image.size
    if width < 700 or height < 900:
        return None
    sample = image.convert("RGB")
    sample.thumbnail((240, 420))
    pixels = sample.load()
    sw, sh = sample.size
    visited = bytearray(sw * sh)
    best = None
    for sy in range(sh):
        for sx in range(sw):
            start = sy * sw + sx
            if visited[start]:
                continue
            visited[start] = 1
            red, green, blue = pixels[sx, sy]
            if not (blue > 145 and blue - red > 22 and green - red > 12):
                continue
            stack = [(sx, sy)]
            count = 0
            left = right = sx
            top = bottom = sy
            while stack:
                x, y = stack.pop()
                count += 1
                left, right = min(left, x), max(right, x)
                top, bottom = min(top, y), max(bottom, y)
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < sw and 0 <= ny < sh):
                        continue
                    index = ny * sw + nx
                    if visited[index]:
                        continue
                    visited[index] = 1
                    r, g, b = pixels[nx, ny]
                    if b > 145 and b - r > 22 and g - r > 12:
                        stack.append((nx, ny))
            bounds = (left, top, right + 1, bottom + 1)
            if (left <= 2 or top <= 2 or right >= sw - 3 or bottom >= sh - 3 or
                    count < sw * sh * 0.08 or (right - left) < sw * 0.22 or
                    (bottom - top) < sh * 0.45):
                continue
            if best is None or count > best[0]:
                best = (count, bounds)
    if best is None:
        return None
    _, (left, top, right, bottom) = best
    margin = 5
    return (max(0, int((left - margin) * width / sw)),
            max(0, int((top - margin) * height / sh)),
            min(width, int((right + margin) * width / sw)),
            min(height, int((bottom + margin) * height / sh)))


def remap_regions(regions: list[dict], crop: tuple[int, int, int, int],
                  width: int, height: int) -> None:
    left, top, right, bottom = crop
    for region in regions:
        box = region["box"]
        if box is None:
            continue
        region["box"] = [round((left + box[0] * (right - left)) / width, 6),
                         round((top + box[1] * (bottom - top)) / height, 6),
                         round((left + box[2] * (right - left)) / width, 6),
                         round((top + box[3] * (bottom - top)) / height, 6)]


def normalized_box(values: list[float], width: int, height: int) -> list[float] | None:
    if len(values) != 4:
        return None
    left, top, right, bottom = values
    if not 0 <= left < right <= width or not 0 <= top < bottom <= height:
        return None
    return [round(left / width, 6), round(top / height, 6),
            round(right / width, 6), round(bottom / height, 6)]


def tesseract_regions(path: Path, width: int, height: int) -> list[dict]:
    try:
        result = subprocess.run(["tesseract", str(path), "stdout", "-l", "spa", "tsv"],
                                check=True, capture_output=True, timeout=45)
    except FileNotFoundError:
        raise WorkerFailure("ENGINE_UNAVAILABLE") from None
    except subprocess.TimeoutExpired:
        raise WorkerFailure("ENGINE_TIMEOUT", True) from None
    except subprocess.CalledProcessError as error:
        if error.returncode in (-9, 137):
            raise WorkerFailure("RESOURCE_FAILURE", True) from None
        raise WorkerFailure("ENGINE_FAILED", True) from None
    try:
        rows = csv.DictReader(io.StringIO(result.stdout.decode("utf-8")), delimiter="\t")
        groups: dict[tuple[str, ...], list[dict]] = {}
        for row in rows:
            if row["level"] != "5" or not row["text"].strip():
                continue
            key = tuple(row[field] for field in ("page_num", "block_num", "par_num", "line_num"))
            groups.setdefault(key, []).append(row)
        regions = []
        for index, words in enumerate(groups.values()):
            x = [int(row["left"]) for row in words]
            y = [int(row["top"]) for row in words]
            right = [int(row["left"]) + int(row["width"]) for row in words]
            bottom = [int(row["top"]) + int(row["height"]) for row in words]
            confidences = [max(0, min(100, float(row["conf"]))) for row in words]
            regions.append({"id": str(index), "text": safe_ocr_text(" ".join(row["text"] for row in words)),
                            "confidence": round(sum(confidences) / len(confidences) / 100, 4),
                            "box": normalized_box([min(x), min(y), max(right), max(bottom)], width, height)})
        return regions
    except (KeyError, ValueError, UnicodeDecodeError):
        raise WorkerFailure("ENGINE_OUTPUT_INVALID") from None


def paddle_regions(path: Path, width: int, height: int, device: str) -> list[dict]:
    detection = os.environ.get("OCR_PADDLE_DETECTION_MODEL_DIR")
    recognition = os.environ.get("OCR_PADDLE_RECOGNITION_MODEL_DIR")
    if not detection or not recognition or not Path(detection).is_dir() or not Path(recognition).is_dir():
        raise WorkerFailure("ENGINE_UNAVAILABLE")
    try:
        with open(os.devnull, "w", encoding="utf-8") as null, redirect_stdout(null):
            from paddleocr import PaddleOCR
            model = PaddleOCR(
                text_detection_model_name=os.environ.get("OCR_PADDLE_DETECTION_MODEL_NAME") or None,
                text_detection_model_dir=detection,
                text_recognition_model_name=os.environ.get("OCR_PADDLE_RECOGNITION_MODEL_NAME") or None,
                text_recognition_model_dir=recognition,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                lang="es",
                device=device,
            )
            prediction = list(model.predict(str(path)))
        if len(prediction) != 1:
            raise WorkerFailure("ENGINE_OUTPUT_INVALID")
        result = prediction[0].json
        if "res" in result:
            result = result["res"]
        texts, scores, boxes = result["rec_texts"], result["rec_scores"], result["rec_boxes"]
        if not len(texts) == len(scores) == len(boxes):
            raise WorkerFailure("ENGINE_OUTPUT_INVALID")
        regions = []
        for index, (text, score, box) in enumerate(zip(texts, scores, boxes)):
            normalized = normalized_box([float(value) for value in box], width, height)
            if normalized is None or not isinstance(text, str) or not 0 <= float(score) <= 1:
                raise WorkerFailure("ENGINE_OUTPUT_INVALID")
            regions.append({"id": str(index), "text": safe_ocr_text(text),
                            "confidence": round(float(score), 4), "box": normalized})
        return regions
    except ImportError:
        raise WorkerFailure("ENGINE_UNAVAILABLE") from None
    except MemoryError:
        raise WorkerFailure("RESOURCE_FAILURE", True) from None
    except WorkerFailure:
        raise
    except Exception:
        raise WorkerFailure("ENGINE_FAILED", True) from None


def process(request: object, allowed_root: Path) -> dict:
    engine, device, sources = validate_request(request, allowed_root.resolve())
    started = time.monotonic()
    pages = []
    for source in sources:
        for page_index, page_path in pages_for_source(source):
            if len(pages) >= MAX_PAGES:
                raise WorkerFailure("PAGE_LIMIT")
            width, height = image_size(page_path)
            with Image.open(page_path) as source_image:
                image = ImageOps.exif_transpose(source_image)
                crop = receipt_crop(image) if source["mediaType"] != "application/pdf" else None
                with tempfile.TemporaryDirectory() as temporary:
                    ocr_path = page_path
                    ocr_width, ocr_height = width, height
                    if crop:
                        prepared = image.crop(crop)
                        scale = min(2, max(1, 1000 // prepared.width))
                        if scale > 1 and prepared.width * prepared.height * scale * scale <= MAX_PIXELS:
                            prepared = prepared.resize((prepared.width * scale,
                                                        prepared.height * scale), Image.Resampling.LANCZOS)
                        ocr_width, ocr_height = prepared.size
                        ocr_path = Path(temporary) / "prepared.png"
                        prepared.save(ocr_path)
                    regions = (tesseract_regions(ocr_path, ocr_width, ocr_height)
                               if engine == "tesseract" else
                               paddle_regions(ocr_path, ocr_width, ocr_height, device))
                    if crop:
                        remap_regions(regions, crop, width, height)
            pages.append({"sourceId": source["id"], "page": page_index,
                          "width": width, "height": height, "regions": regions})
    return {"version": VERSION, "engine": engine, "device": device, "pages": pages,
            "diagnostics": {"durationMs": round((time.monotonic() - started) * 1000)}}


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise WorkerFailure("INVALID_REQUEST")
        request = json.loads(raw)
        allowed_root = Path(os.environ.get("OCR_ALLOWED_ROOT", "/var/lib/receipt-sources"))
        response = process(request, allowed_root)
    except (ValueError, json.JSONDecodeError, WorkerFailure) as error:
        failure = error if isinstance(error, WorkerFailure) else WorkerFailure("INVALID_REQUEST")
        response = {"version": VERSION, "error": {"code": failure.code,
                                                  "retryable": failure.retryable}}
    except Exception:
        response = {"version": VERSION, "error": {"code": "WORKER_FAILED", "retryable": True}}
    sys.stdout.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
    return 0 if "error" not in response else 1


if __name__ == "__main__":
    raise SystemExit(main())
