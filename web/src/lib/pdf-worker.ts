// PDF worker entry: patch the stream API first, then start the pdf.js worker.
import "./stream-polyfill";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
