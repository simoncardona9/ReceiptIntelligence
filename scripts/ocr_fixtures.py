"""Render invented OCR evaluation receipts outside the repository."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "fixtures/ocr/cases.json"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
WIDTH = 960
MARGIN = 48
LINE_HEIGHT = 42


def generate(destination: Path) -> dict:
    destination = destination.resolve()
    if ROOT == destination or ROOT in destination.parents:
        raise ValueError("output directory must be outside the repository")
    definitions = json.loads(CASES.read_text(encoding="utf-8"))
    if definitions.get("version") != 1:
        raise ValueError("unsupported fixture version")
    destination.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(FONT, 27)
    manifest = {"version": 1, "cases": []}
    for case in definitions["cases"]:
        pages = []
        evidence = []
        for page_index, source_lines in enumerate(case["pages"]):
            lines = list(source_lines)
            if case.get("repeat_item") and page_index == 0:
                insert_at = next(i for i, line in enumerate(lines) if line[0] == "subtotal")
                lines[insert_at:insert_at] = [
                    ["description", f"PRODUCTO SINTETICO {i:02d}"]
                    for i in range(case["repeat_item"])
                ]
            height = max(450, MARGIN * 2 + len(lines) * LINE_HEIGHT)
            image = Image.new("RGB", (WIDTH, height), "white")
            draw = ImageDraw.Draw(image)
            for index, (kind, value) in enumerate(lines):
                x, y = MARGIN, MARGIN + index * LINE_HEIGHT
                draw.text((x, y), value, fill="black", font=font)
                left, top, right, bottom = draw.textbbox((x, y), value, font=font)
                evidence.append({"kind": kind, "text": value, "page": page_index,
                                 "box": [left / WIDTH, top / height,
                                         right / WIDTH, bottom / height]})
            if case.get("effect") == "blur":
                image = image.filter(ImageFilter.GaussianBlur(radius=1.2))
            elif case.get("effect") == "glare":
                overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
                ImageDraw.Draw(overlay).ellipse((WIDTH - 340, 100, WIDTH + 50, 420),
                                                fill=(255, 255, 255, 135))
                image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
            elif case.get("effect") == "skew":
                image = image.rotate(3, expand=False, fillcolor="white")
                # Rotated coordinates need a matching transform; omit box scoring
                # for this deliberately distorted source.
                evidence = [{**item, "box": None} for item in evidence]
            pages.append(image)
        output = destination / f"{case['id']}.{case['format']}"
        if case["format"] == "pdf":
            pages[0].save(output, "PDF", save_all=True, append_images=pages[1:], resolution=96)
        else:
            pages[0].save(output, "PNG")
        manifest["cases"].append({"id": case["id"], "type": case["type"],
                                  "tags": case["tags"], "source": output.name,
                                  "page_sizes": [[page.width, page.height] for page in pages],
                                  "expected": evidence})
    (destination / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = generate(args.output)
    print(f"Generated {len(result['cases'])} synthetic cases in {args.output.resolve()}")
