// Extracts text page by page in the browser, so only text goes to the database.
import "./stream-polyfill";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Our own worker entry, so the Safari stream patch also runs inside the worker.
let worker: Worker | null = null;
function ensureWorker() {
  if (!worker) {
    worker = new Worker(new URL("./pdf-worker.ts", import.meta.url), { type: "module" });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
}

export async function pdfToPages(file: File, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  ensureWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Rebuild lines from text items using their vertical position.
    let lastY: number | null = null;
    let out = "";
    for (const it of tc.items as any[]) {
      if (typeof it.str !== "string") continue;
      const y = it.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) out += "\n";
      else if (out && !out.endsWith(" ") && it.str && !it.str.startsWith(" ")) out += " ";
      out += it.str;
      if (y !== undefined) lastY = y;
    }
    pages.push(out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
    onProgress?.(i, doc.numPages);
    page.cleanup();
  }
  await doc.cleanup();
  return pages;
}

export function guessKind(filename: string): "annual" | "quarterly" | "transcript" | "other" {
  const f = filename.toLowerCase();
  if (/transcript|earnings[-_ ]?call|call[-_ ]?transcript/.test(f)) return "transcript";
  if (/10-?q|quarter|\bq[1-4]\b|q[1-4][-_ ]?20\d\d|interim/.test(f)) return "quarterly";
  if (/10-?k|annual|40-?f|20-?f|\bar\b|aif/.test(f)) return "annual";
  return "annual";
}
