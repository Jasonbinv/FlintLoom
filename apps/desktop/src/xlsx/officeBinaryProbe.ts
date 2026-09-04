const OLE_COMPOUND_MAGIC = new Uint8Array([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

async function readBlobHead(blob: Blob, length: number): Promise<Uint8Array> {
  const slice = blob.slice(0, length);
  if (typeof slice.arrayBuffer === "function") {
    return new Uint8Array(await slice.arrayBuffer());
  }
  return new Uint8Array(await new Response(slice).arrayBuffer());
}

export async function isOleCompoundDocument(blob: Blob): Promise<boolean> {
  const head = await readBlobHead(blob, OLE_COMPOUND_MAGIC.length);
  if (head.length < OLE_COMPOUND_MAGIC.length) return false;
  for (let i = 0; i < OLE_COMPOUND_MAGIC.length; i += 1) {
    if (head[i] !== OLE_COMPOUND_MAGIC[i]) return false;
  }
  return true;
}

export function looksLikeDecodedText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const replacementCount = (trimmed.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) return false;
  let controlCount = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32) controlCount += 1;
  }
  return controlCount <= Math.max(2, Math.floor(trimmed.length * 0.01));
}

export async function isZipContainer(blob: Blob): Promise<boolean> {
  const head = await readBlobHead(blob, 4);
  return (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04
  );
}
