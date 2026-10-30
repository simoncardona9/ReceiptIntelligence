"""Focused checks for the synthetic OCR evaluation boundary."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr_benchmark import benchmark, score_case, validate_prediction  # noqa: E402
from ocr_compare import compare  # noqa: E402
from ocr_fixtures import generate  # noqa: E402


class OcrBenchmarkTests(unittest.TestCase):
    def test_all_four_types_render_and_expected_boxes_are_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = generate(Path(directory))
            self.assertEqual({case["type"] for case in manifest["cases"]},
                             {"supermarket", "restaurant", "fuel", "utility"})
            self.assertTrue(any(len(case["page_sizes"]) == 2 for case in manifest["cases"]))
            for case in manifest["cases"]:
                self.assertTrue((Path(directory) / case["source"]).is_file())
                for expected in case["expected"]:
                    if expected["box"] is not None:
                        self.assertTrue(all(0 <= value <= 1 for value in expected["box"]))

    def test_score_counts_fields_lines_and_coordinates(self):
        case = {"expected": [
            {"kind": "merchant", "text": "MERCADO ÁRBOL", "page": 0,
             "box": [0.1, 0.1, 0.5, 0.2]},
            {"kind": "description", "text": "PAN", "page": 0,
             "box": [0.1, 0.3, 0.5, 0.4]},
        ]}
        regions = [
            {"id": "1", "text": "mercado arbol", "page": 0,
             "box": [0.1, 0.1, 0.5, 0.2]},
            {"id": "2", "text": "pan", "page": 0, "box": None},
        ]
        score = score_case(case, regions)
        self.assertEqual((score["field_matched"], score["line_matched"]), (1, 1))
        self.assertEqual((score["location_expected"], score["location_matched"]), (2, 1))

    def test_invalid_prediction_rejected(self):
        base = {"version": 1, "regions": [{"id": "a", "page": 0,
                                          "text": "invented", "box": [0, 0, 0.5, 0.5]}]}
        self.assertEqual(len(validate_prediction(base, 1)), 1)
        for region in (
            {"id": "a", "page": 1, "text": "x"},
            {"id": "a", "page": 0, "text": "x", "box": [0.5, 0, 0.2, 1]},
            {"id": "a", "page": 0, "text": "x", "confidence": 2},
            {"id": "a", "page": 0, "text": "x", "confidence": float("nan")},
        ):
            with self.assertRaises(ValueError):
                validate_prediction({"version": 1, "regions": [region]}, 1)
        with self.assertRaises(ValueError):
            validate_prediction({"version": 1, "regions": [base["regions"][0]] * 2}, 1)

    def test_failed_command_reports_safe_error_without_receipt_text(self):
        with tempfile.TemporaryDirectory() as directory:
            generate(Path(directory))
            report = benchmark(Path(directory) / "manifest.json", "broken", "cpu",
                               [sys.executable, "-c", "import sys; print('PRIVATE OCR'); sys.exit(2)"], 5)
            self.assertEqual(report["summary"]["failed_cases"], 5)
            self.assertGreater(report["summary"]["expected"], 0)
            self.assertEqual(report["summary"]["errors"], report["summary"]["expected"])
            self.assertNotIn("PRIVATE OCR", json.dumps(report))

    def test_complete_synthetic_run_scores_without_copying_ocr_text_to_report(self):
        with tempfile.TemporaryDirectory() as directory:
            generate(Path(directory))
            command = Path(directory) / "synthetic_engine.py"
            command.write_text(
                "import json, pathlib, sys\n"
                "source = pathlib.Path(sys.argv[1])\n"
                "manifest = json.loads((source.parent / 'manifest.json').read_text())\n"
                "case = next(c for c in manifest['cases'] if c['source'] == source.name)\n"
                "print(json.dumps({'version': 1, 'regions': "
                "[{'id': str(i), 'page': e['page'], 'text': e['text'], "
                "'box': e['box']} for i, e in enumerate(case['expected'])]}))\n",
                encoding="utf-8",
            )
            report = benchmark(Path(directory) / "manifest.json", "synthetic", "cpu",
                               [sys.executable, str(command)], 5)
            self.assertEqual(report["summary"]["failed_cases"], 0)
            self.assertEqual(report["summary"]["matched"], report["summary"]["expected"])
            self.assertEqual(report["summary"]["location_matched"],
                             report["summary"]["location_expected"])
            self.assertNotIn("MERCADO SOL DEL SUR", json.dumps(report))

    def test_timeout_is_safe_and_counts_as_missed_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            generate(Path(directory))
            report = benchmark(Path(directory) / "manifest.json", "slow", "cpu",
                               [sys.executable, "-c", "import time; time.sleep(1)"], 0.01)
            self.assertEqual(report["summary"]["failed_cases"], 5)
            self.assertEqual(report["summary"]["errors"], report["summary"]["expected"])
            self.assertTrue(all(case["error"] == "OCR command timed out"
                                for case in report["cases"]))

    def test_comparison_requires_matching_corpus(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            summary = {"failed_cases": 0, "field_matched": 1, "field_expected": 2,
                       "line_matched": 2, "line_expected": 2,
                       "location_matched": 1, "location_expected": 2,
                       "mean_latency_ms": 10, "max_peak_host_rss_kib": 100}
            report = {"version": 1, "corpus_sha256": "same", "engine": "one",
                      "device": "cpu", "summary": summary}
            first.write_text(json.dumps(report), encoding="utf-8")
            second.write_text(json.dumps({**report, "engine": "two"}), encoding="utf-8")
            self.assertIn("50.0%", "\n".join(compare([first, second])))
            second.write_text(json.dumps({**report, "corpus_sha256": "different"}), encoding="utf-8")
            with self.assertRaises(ValueError):
                compare([first, second])


if __name__ == "__main__":
    unittest.main()
