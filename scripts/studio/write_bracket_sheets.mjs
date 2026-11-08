import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function pdf(lines) {
  const stream = ["BT", "/F1 12 Tf", ...lines.map((line, index) => `1 0 0 1 36 ${720 - index * 18} Tm (${line}) Tj`), "ET"].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}

const files = {
  "public/samples/br-200-detail.pdf": [
    "PART NUMBER: BR-200",
    "REVISION: B",
    "MATERIAL: Aluminium 6061-T6",
    "OVERALL SIZE: 150 x 90 x 20 mm",
    "4 holes diameter 8 mm depth 12 mm",
    "1 pocket depth 6 mm width 30 mm",
  ],
  "public/samples/br-200-section.pdf": [
    "PART NUMBER: BR-200",
    "SECTION A-A",
    "2 holes diameter 8 mm depth 12 mm",
    "4 threads M6",
    "profile the outside",
  ],
};

for (const [target, lines] of Object.entries(files)) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, pdf(lines));
  console.log(target);
}
