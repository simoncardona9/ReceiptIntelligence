"""Compare reports generated from the same synthetic OCR corpus."""

import argparse
import json
from pathlib import Path


def ratio(numerator: int, denominator: int) -> str:
    return f"{numerator / denominator:.1%}" if denominator else "n/a"


def compare(paths: list[Path]) -> list[str]:
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    hashes = {report.get("corpus_sha256") for report in reports}
    if any(report.get("version") != 1 for report in reports) or None in hashes or len(hashes) != 1:
        raise ValueError("reports must use version 1 and the same corpus")
    rows = ["engine\tdevice\tfailures\tfields\tlines\tlocations\tmean ms\tpeak host KiB"]
    for report in reports:
        summary = report["summary"]
        rows.append("\t".join((
            report["engine"], report["device"], str(summary["failed_cases"]),
            ratio(summary["field_matched"], summary["field_expected"]),
            ratio(summary["line_matched"], summary["line_expected"]),
            ratio(summary["location_matched"], summary["location_expected"]),
            str(summary["mean_latency_ms"]), str(summary["max_peak_host_rss_kib"]),
        )))
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    args = parser.parse_args()
    try:
        print("\n".join(compare(args.reports)))
    except (ValueError, KeyError, OSError, json.JSONDecodeError):
        parser.error("invalid or incompatible benchmark reports")
