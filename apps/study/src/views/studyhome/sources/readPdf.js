// Reads the text out of a PDF with PDF.js, Mozilla's PDF reader. The
// library is large, so it loads only when someone adds a PDF. The legacy
// build also runs in older browser engines, like the desktop app's.

// Sources are saved inside the app, where space is limited, so a very long
// PDF keeps only its first pages (about 150 pages of dense text).
export const MAX_PDF_CHARS = 300000;

// PDF.js gives a page as text pieces; a piece can end a line.
export const itemsToText = (items) =>
  items
    .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : ""))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

const readBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

// { text, pageCount, readPages, truncated }
export async function pdfText(file) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await readBuffer(file)) });
  const doc = await task.promise;
  const pages = [];
  let length = 0;
  let readPages = 0;
  try {
    while (readPages < doc.numPages && length < MAX_PDF_CHARS) {
      const page = await doc.getPage(readPages + 1);
      const text = itemsToText((await page.getTextContent()).items);
      pages.push(text);
      length += text.length + 2;
      readPages += 1;
    }
  } finally {
    task.destroy();
  }
  const text = pages.filter(Boolean).join("\n\n");
  return {
    text: text.slice(0, MAX_PDF_CHARS),
    pageCount: doc.numPages,
    readPages,
    truncated: readPages < doc.numPages || text.length > MAX_PDF_CHARS,
  };
}
