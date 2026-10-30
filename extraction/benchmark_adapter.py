"""Run the local worker against one synthetic benchmark source."""

import json
import os
from pathlib import Path
import sys

from worker import process, WorkerFailure


def main() -> int:
    if len(sys.argv) != 2:
        return 2
    path = Path(sys.argv[1]).resolve()
    media = "application/pdf" if path.suffix.lower() == ".pdf" else "image/png"
    try:
        result = process({"version": 1,
                          "engine": os.environ.get("OCR_ENGINE", "tesseract"),
                          "device": os.environ.get("OCR_DEVICE", "cpu"),
                          "sources": [{"id": "synthetic", "path": str(path),
                                       "mediaType": media}]}, path.parent)
    except WorkerFailure:
        return 1
    regions = [{"id": f"{page['page']}-{region['id']}", "page": page["page"],
                "text": region["text"], "confidence": region["confidence"],
                "box": region["box"]}
               for page in result["pages"] for region in page["regions"]]
    print(json.dumps({"version": 1, "regions": regions}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
