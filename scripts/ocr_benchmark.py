"""Score local OCR text regions against generated synthetic evidence."""

import argparse
from collections import defaultdict
from difflib import SequenceMatcher
import hashlib
import json
import math
from pathlib import Path
import shlex
import subprocess
import threading
import time
import unicodedata

FIELD_KINDS = {"merchant", "date", "subtotal", "tax", "total", "currency", "payment_method"}
LINE_KINDS = {"description", "quantity", "unit_price", "discount", "line_total"}
KINDS = FIELD_KINDS | LINE_KINDS


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    return " ".join("".join(ch for ch in value if not unicodedata.combining(ch)).split())


def overlap(a: list[float], b: list[float]) -> float:
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0, min(a[3], b[3]) - max(a[1], b[1])
    )
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return intersection / (area_a + area_b - intersection) if area_a + area_b > intersection else 0.0


def validate_prediction(payload: object, page_count: int) -> list[dict]:
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise ValueError("invalid OCR output version")
    regions = payload.get("regions")
    if not isinstance(regions, list) or len(regions) > 10000:
        raise ValueError("invalid OCR regions")
    ids = set()
    for region in regions:
        if not isinstance(region, dict) or not isinstance(region.get("id"), str) or not region["id"]:
            raise ValueError("invalid region ID")
        if region["id"] in ids:
            raise ValueError("duplicate region ID")
        ids.add(region["id"])
        if not isinstance(region.get("page"), int) or isinstance(region["page"], bool) or not 0 <= region["page"] < page_count:
            raise ValueError("invalid page")
        if not isinstance(region.get("text"), str) or len(region["text"]) > 10000:
            raise ValueError("invalid text")
        confidence = region.get("confidence")
        if confidence is not None and (not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise ValueError("invalid confidence")
        box = region.get("box")
        if box is not None and (not isinstance(box, list) or len(box) != 4 or
                                any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or not 0 <= v <= 1 for v in box) or
                                box[0] >= box[2] or box[1] >= box[3]):
            raise ValueError("invalid normalized box")
    return regions


def score_case(case: dict, regions: list[dict]) -> dict:
    used = set()
    counts = defaultdict(lambda: {"expected": 0, "matched": 0})
    location_expected = 0
    location_matched = 0
    similarity_sum = 0.0
    for expected in case["expected"]:
        kind = expected["kind"]
        if kind not in KINDS:
            raise ValueError("unknown expected kind")
        counts[kind]["expected"] += 1
        if expected["box"] is not None:
            location_expected += 1
        desired = normalized(expected["text"])
        choices = []
        for index, region in enumerate(regions):
            if index in used or region["page"] != expected["page"]:
                continue
            actual = normalized(region["text"])
            similarity = SequenceMatcher(None, desired, actual).ratio()
            if actual and (desired in actual or actual in desired):
                similarity = max(similarity, min(len(desired), len(actual)) / max(len(desired), len(actual)))
            location = (overlap(expected["box"], region["box"])
                        if expected["box"] is not None and region.get("box") is not None else 0.0)
            choices.append((similarity, location, index))
        if not choices:
            continue
        similarity, _, index = max(choices)
        if similarity < 0.8:
            continue
        used.add(index)
        counts[kind]["matched"] += 1
        similarity_sum += similarity
        if expected["box"] is not None:
            box = regions[index].get("box")
            if box is not None and overlap(expected["box"], box) >= 0.5:
                location_matched += 1
    total = sum(value["expected"] for value in counts.values())
    matched = sum(value["matched"] for value in counts.values())
    return {"expected": total, "matched": matched, "errors": total - matched,
            "field_expected": sum(counts[k]["expected"] for k in FIELD_KINDS),
            "field_matched": sum(counts[k]["matched"] for k in FIELD_KINDS),
            "line_expected": sum(counts[k]["expected"] for k in LINE_KINDS),
            "line_matched": sum(counts[k]["matched"] for k in LINE_KINDS),
            "location_expected": location_expected, "location_matched": location_matched,
            "mean_text_similarity": round(similarity_sum / matched, 4) if matched else None,
            "by_kind": dict(counts)}


def current_rss_kib(pid: int) -> int:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except (FileNotFoundError, ProcessLookupError):
        pass
    return 0


def run_engine(command: list[str], source: Path, timeout: float) -> tuple[object, dict]:
    start = time.perf_counter()
    process = subprocess.Popen([*command, str(source)], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, cwd=source.parent)
    peak = 0
    active = True

    def sample() -> None:
        nonlocal peak
        while active:
            peak = max(peak, current_rss_kib(process.pid))
            time.sleep(0.01)

    monitor = threading.Thread(target=sample, daemon=True)
    monitor.start()
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise ValueError("OCR command timed out") from None
    finally:
        active = False
        monitor.join()
    elapsed = round((time.perf_counter() - start) * 1000, 2)
    if process.returncode != 0:
        raise ValueError("OCR command failed")
    if len(output) > 2_000_000:
        raise ValueError("OCR output too large")
    try:
        payload = json.loads(output)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("invalid OCR JSON") from None
    return payload, {"latency_ms": elapsed, "peak_host_rss_kib": peak}


def benchmark(manifest_path: Path, name: str, device: str, command: list[str], timeout: float) -> dict:
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("version") != 1 or not isinstance(manifest.get("cases"), list):
        raise ValueError("invalid fixture manifest")
    results = []
    ids = set()
    for case in manifest["cases"]:
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id or case_id in ids:
            raise ValueError("invalid or duplicate case ID")
        ids.add(case_id)
        source = manifest_path.parent / case["source"]
        if not source.is_file() or source.parent.resolve() != manifest_path.parent.resolve():
            raise ValueError("missing or invalid source")
        result = {"id": case_id, "type": case["type"], "tags": case["tags"]}
        try:
            payload, measurements = run_engine(command, source, timeout)
            regions = validate_prediction(payload, len(case["page_sizes"]))
            result.update({"status": "ok", **score_case(case, regions), **measurements})
        except (ValueError, OSError) as error:
            result.update({"status": "error", "error": str(error) if isinstance(error, ValueError) else "OCR command unavailable",
                           **score_case(case, [])})
        results.append(result)
    valid = [result for result in results if result["status"] == "ok"]
    totals = {key: sum(result[key] for result in results) for key in
              ("expected", "matched", "errors", "field_expected", "field_matched",
               "line_expected", "line_matched", "location_expected", "location_matched")}
    totals["failed_cases"] = len(results) - len(valid)
    totals["mean_latency_ms"] = round(sum(result["latency_ms"] for result in valid) / len(valid), 2) if valid else None
    totals["max_peak_host_rss_kib"] = max((result["peak_host_rss_kib"] for result in valid), default=None)
    return {"version": 1, "corpus_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "engine": name, "device": device, "summary": totals, "cases": results}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--device", choices=("cpu", "gpu"), default="cpu")
    parser.add_argument("--command", required=True, help="local command; source path is appended")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.timeout <= 0 or not shlex.split(args.command):
        parser.error("command and positive timeout are required")
    try:
        report = benchmark(args.manifest, args.name, args.device,
                           shlex.split(args.command), args.timeout)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.error(str(error))
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{args.name} ({args.device}): {report['summary']['matched']}/{report['summary']['expected']} evidence lines; {report['summary']['failed_cases']} failed cases")
    return 1 if report["summary"]["failed_cases"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
