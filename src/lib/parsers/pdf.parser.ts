export interface ParsedPage {
  pageNumber: number;
  text: string;
  tables: string[];
}

export interface RenderedPdfPage {
  pageNumber: number;
  png: Buffer;
}

export interface ParsedDocument {
  text: string;
  pages: ParsedPage[];
  pageCount: number;
  metadata: Record<string, unknown>;
  /** Present when the PDF is a plot with no text layer, so the page can be read as an image. */
  renderedPages?: RenderedPdfPage[];
}

/**
 * Extract text and tables from a PDF buffer.
 * Uses pdf-parse for text extraction (server-side safe).
 */
const PAGE_MARKER = /--\s*\d+\s*of\s*\d+\s*--/g;

function ensurePdfDom(): void {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const canvas = require("@napi-rs/canvas") as {
    DOMMatrix: typeof globalThis.DOMMatrix;
    ImageData: typeof globalThis.ImageData;
    Path2D: typeof globalThis.Path2D;
  };
  globalThis.DOMMatrix = canvas.DOMMatrix;
  globalThis.ImageData = canvas.ImageData;
  globalThis.Path2D = canvas.Path2D;
}

export async function parsePDF(buffer: Buffer): Promise<ParsedDocument> {
  // pdf-parse v2 runs PDF.js, which needs DOMMatrix from @napi-rs/canvas in Node.
  ensurePdfDom();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse") as {
    PDFParse: new (options: { data: Buffer }) => {
      getText: () => Promise<{ text: string; total: number; pages: { num: number; text: string }[] }>;
      getScreenshot: (params: { imageBuffer: boolean; imageDataUrl: boolean; scale: number }) => Promise<{
        pages: { pageNumber: number; data: Uint8Array }[];
      }>;
      destroy: () => Promise<void>;
    };
  };

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages: ParsedPage[] = result.pages.map((page) => {
      const text = page.text.replace(PAGE_MARKER, "").trim();
      return {
        pageNumber: page.num,
        text,
        tables: extractMarkdownTables(text),
      };
    });
    const text = pages.map((page) => page.text).filter(Boolean).join("\n\n");

    let renderedPages: RenderedPdfPage[] | undefined;
    if (text.length < 40) {
      const shot = await parser.getScreenshot({ imageBuffer: true, imageDataUrl: false, scale: 2 });
      renderedPages = shot.pages.slice(0, 5).map((page) => ({
        pageNumber: page.pageNumber,
        png: Buffer.from(page.data),
      }));
    }

    return {
      text,
      pages,
      pageCount: result.total,
      metadata: { numpages: result.total },
      renderedPages,
    };
  } finally {
    await parser.destroy();
  }
}

/**
 * Naively detect table-like content in text and return as markdown.
 * A real implementation would use a dedicated table extraction library.
 */
function extractMarkdownTables(text: string): string[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const tables: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    // Heuristic: lines with multiple pipe characters or consistent tab/space separation
    const cellCount = (line.match(/\s{2,}|\t/g) || []).length;
    if (cellCount >= 2) {
      inTable = true;
      tableLines.push(line);
    } else {
      if (inTable && tableLines.length >= 2) {
        tables.push(buildMarkdownTable(tableLines));
      }
      inTable = false;
      tableLines = [];
    }
  }

  if (inTable && tableLines.length >= 2) {
    tables.push(buildMarkdownTable(tableLines));
  }

  return tables;
}

function buildMarkdownTable(lines: string[]): string {
  const rows = lines.map((l) => l.split(/\s{2,}|\t/).filter(Boolean));
  const maxCols = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    while (r.length < maxCols) r.push("");
    return `| ${r.join(" | ")} |`;
  });
  const separator = `| ${Array(maxCols).fill("---").join(" | ")} |`;
  return [padded[0], separator, ...padded.slice(1)].join("\n");
}
