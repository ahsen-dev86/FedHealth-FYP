"""Render the example CBC report as a PNG test fixture for image OCR (synthetic, not a real patient)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROWS = [
    ("Test", "Result", "Unit", "Reference range"),
    ("Total Leucocyte Count (TLC)", "9,010", "/mm3", "4,000 - 11,000"),
    ("Red Blood Cells", "4.47", "mil/mm3", "4.5 - 5.5"),
    ("Haemoglobin", "12.4", "g/dL", "13.0 - 17.0"),
    ("Haematocrit (HCT)", "38", "%", "40 - 50"),
    ("MCV", "85", "fl", "80 - 100"),
    ("MCH", "28", "pg", "27 - 32"),
    ("MCHC", "33", "g/dL", "32 - 36"),
    ("RDW-CV", "13", "%", "11.5 - 14.5"),
    ("Platelet Count", "147,000", "/mm3", "150,000 - 400,000"),
    ("Neutrophils", "69", "%", "40 - 75"),
    ("Lymphocytes", "25", "%", "20 - 40"),
]
COLUMNS = [60, 700, 960, 1200]


def main():
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 34)
    bold = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 40)
    image = Image.new("RGB", (1650, 170 + 62 * len(ROWS)), "white")
    draw = ImageDraw.Draw(image)
    draw.text((60, 40), "COMPLETE BLOOD COUNT (CBC)  -  SAMPLE REPORT FOR TESTING", font=bold, fill="black")
    for i, row in enumerate(ROWS):
        y = 130 + 62 * i
        for x, cell in zip(COLUMNS, row):
            draw.text((x, y), cell, font=bold if i == 0 else font, fill="black")
    out = Path(__file__).resolve().parents[1] / "Module 1-2 Merged Backend/test/fixtures/cbc_report.png"
    image.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
