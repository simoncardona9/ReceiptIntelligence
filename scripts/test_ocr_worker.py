"""Synthetic local worker contract checks."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "extraction"))
import worker  # noqa: E402
from ocr_fixtures import generate  # noqa: E402


class WorkerTests(unittest.TestCase):
    def test_image_and_pdf_page_order_and_safe_output(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = generate(Path(directory))
            image = next(case for case in manifest["cases"] if case["id"] == "supermarket_uyu")
            pdf = next(case for case in manifest["cases"] if case["id"] == "utility_uyu_pdf")
            sources = [{"id": "image", "mediaType": "image/png",
                        "path": str(Path(directory) / image["source"])},
                       {"id": "pdf", "mediaType": "application/pdf",
                        "path": str(Path(directory) / pdf["source"])}]
            with patch.object(worker, "tesseract_regions", return_value=[
                {"id": "0", "text": "SINTETICO", "confidence": 0.9,
                 "box": [0.1, 0.1, 0.2, 0.2]}]):
                result = worker.process({"version": 1, "engine": "tesseract", "device": "cpu",
                                         "sources": sources}, Path(directory))
            self.assertEqual([(page["sourceId"], page["page"]) for page in result["pages"]],
                             [("image", 0), ("pdf", 0), ("pdf", 1)])
            self.assertNotIn(directory, str(result))

    def test_root_media_and_device_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = generate(Path(directory))
            source = {"id": "a", "mediaType": "image/png",
                      "path": str(Path(directory) / manifest["cases"][0]["source"])}
            with self.assertRaises(worker.WorkerFailure) as caught:
                worker.validate_request({"version": 1, "engine": "tesseract",
                                         "device": "gpu", "sources": [source]}, Path(directory))
            self.assertEqual(caught.exception.code, "UNSUPPORTED_DEVICE")
            with self.assertRaises(worker.WorkerFailure) as caught:
                worker.validate_request({"version": 1, "engine": "tesseract",
                                         "sources": [source]}, Path(directory) / "other")
            self.assertEqual(caught.exception.code, "SOURCE_UNAVAILABLE")

    def test_tesseract_tsv_groups_words_into_one_region(self):
        tsv = ("level\tpage_num\tblock_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n"
               "5\t1\t1\t1\t1\t10\t20\t40\t20\t90\tTOTAL\n"
               "5\t1\t1\t1\t1\t55\t20\t30\t20\t80\tUYU\n")
        result = type("Result", (), {"stdout": tsv.encode("utf-8")})()
        with patch.object(worker.subprocess, "run", return_value=result):
            regions = worker.tesseract_regions(Path("unused"), 100, 100)
        self.assertEqual(regions[0]["text"], "TOTAL UYU")
        self.assertEqual(regions[0]["box"], [0.1, 0.2, 0.85, 0.4])

    def test_missing_paddle_models_return_safe_error(self):
        with patch.dict(worker.os.environ, {}, clear=True):
            with self.assertRaises(worker.WorkerFailure) as caught:
                worker.paddle_regions(Path("unused"), 100, 100, "cpu")
        self.assertEqual(caught.exception.code, "ENGINE_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
