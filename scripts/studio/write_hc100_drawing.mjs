import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const lines = [
  "HOLLOW CYLINDER FROM RECTANGULAR BAR",
  "PART NUMBER: HC-100",
  "REVISION: A",
  "MATERIAL: Aluminium 6061-T6",
  "STOCK: rectangular bar 40 x 40 x 80 mm",
  "FINISHED OUTSIDE DIAMETER: 32 mm",
  "BORE: 16 mm through",
  "FINISHED LENGTH: 80 mm",
  "PROCESS: turn the rectangular bar to a cylinder, then bore the hole",
  "HOLD: 12 mm grip in a 3-jaw chuck. The bore stops clear of the jaws.",
];

function escapePdf(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const stream = [
  "BT",
  "/F1 12 Tf",
  ...lines.map((line, index) => `1 0 0 1 36 ${720 - index * 18} Tm (${escapePdf(line)}) Tj`),
  "ET",
  "0.8 w",
  "36 360 240 70 re S",
  "36 395 m 276 395 l S",
  "320 360 90 70 re S",
].join("\n");

const objects = [
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
  "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
  `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
  "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
];

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const object of objects) {
  offsets.push(pdf.length);
  pdf += object;
}
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let index = 1; index < offsets.length; index += 1) {
  pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

for (const target of ["public/samples/hc-100-hollow-cylinder.pdf", "test/rect-rod-hollow-cylinder.pdf"]) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, pdf);
  console.log(target);
}
