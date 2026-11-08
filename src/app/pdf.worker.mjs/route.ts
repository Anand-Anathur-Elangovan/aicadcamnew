import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";

export const runtime = "nodejs";

/** Same-origin PDF.js worker. The CDN copy does not match this pdfjs-dist build. */
export function GET() {
  const filePath = join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
