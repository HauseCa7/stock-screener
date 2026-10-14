// Older Safari can't loop over a ReadableStream with `for await`, which pdf.js relies on.
// This adds that ability (ReadableStream.prototype[Symbol.asyncIterator]) where it's missing.
const RS = (globalThis as any).ReadableStream;
if (RS && !RS.prototype[Symbol.asyncIterator]) {
  RS.prototype[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  if (!RS.prototype.values) RS.prototype.values = RS.prototype[Symbol.asyncIterator];
}
export {};
