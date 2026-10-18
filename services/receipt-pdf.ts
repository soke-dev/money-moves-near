/**
 * A PDF containing one JPEG, assembled by hand.
 *
 * The alternative was expo-print, which renders HTML to PDF natively - but it
 * is a native module, so adding it means rebuilding the dev client, and it
 * would have meant rebuilding the receipt a second time in HTML to match the
 * screen. Wrapping the screenshot we already take keeps one design and adds no
 * dependency.
 *
 * A single-image PDF is about as simple as the format gets: a catalogue, a page
 * tree, one page, the JPEG as an XObject with the DCTDecode filter (JPEG is a
 * native PDF image encoding, so the bytes go in untouched), and a two-operator
 * content stream that stamps it across the page.
 */

/** Width of the page in points. A receipt reads as a narrow slip, not a letter. */
/**
 * A4, in points.
 *
 * The page used to be cut to the receipt's own aspect ratio, which made a tall
 * narrow page that a viewer opens edge to edge with nothing around it - it
 * reads as a screenshot rather than a document, and prints unpredictably.
 */
const PAGE_W = 595;
const PAGE_H = 842;

/** Half an inch, which also clears the unprintable margin on most printers. */
const MARGIN = 36;

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Hermes has no atob, and the bytes have to survive intact, so decode by hand.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, "").replace(/[^A-Za-z0-9+/=]/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);

  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (BASE64.indexOf(clean[i]) << 18) |
      (BASE64.indexOf(clean[i + 1]) << 12) |
      ((BASE64.indexOf(clean[i + 2]) & 63) << 6) |
      (BASE64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

/**
 * Pull the pixel dimensions out of a JPEG.
 *
 * Walk the markers to a start-of-frame, which carries height and width. Taking
 * them from the file rather than from the caller means the page can never end
 * up the wrong shape because a capture came back at a different size than
 * asked for.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    // SOF0-SOF15, minus the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

const ascii = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/**
 * Build the PDF.
 *
 * Offsets in the cross-reference table have to be exact byte positions, so the
 * file is assembled as a list of chunks and each object's offset is recorded as
 * it is appended rather than calculated afterwards.
 */
export function buildImagePdf(jpegBase64: string): Uint8Array {
  const jpeg = base64ToBytes(jpegBase64);
  const size = jpegSize(jpeg);
  if (!size) throw new Error("Not a JPEG, or no frame header found");

  // Fit inside the margins without distorting: one scale for both axes, and
  // whichever axis runs out first decides it.
  const scale = Math.min(
    (PAGE_W - MARGIN * 2) / size.width,
    (PAGE_H - MARGIN * 2) / size.height,
  );
  const drawW = size.width * scale;
  const drawH = size.height * scale;
  const drawX = (PAGE_W - drawW) / 2;
  const drawY = (PAGE_H - drawH) / 2;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];

  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? ascii(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** Records where this object starts, which is what the xref table needs. */
  const startObject = (num: number, header: string) => {
    offsets[num] = length;
    push(header);
  };

  push("%PDF-1.4\n");

  startObject(1, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject(2, "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  startObject(
    3,
    "3 0 obj\n<< /Type /Page /Parent 2 0 R " +
      `/MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
  );

  // The JPEG goes in as-is: DCTDecode is the JPEG codec, so no re-encoding.
  startObject(
    4,
    "4 0 obj\n<< /Type /XObject /Subtype /Image " +
      `/Width ${size.width} /Height ${size.height} ` +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode " +
      `/Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  // The page is painted in the receipt's own field colour before anything
  // else, so the margin reads as part of the design instead of a white border
  // nobody cropped off. Matches FIELD (#0B0B0C) on the receipt screen.
  const field = `${(0x0b / 255).toFixed(3)} ${(0x0b / 255).toFixed(3)} ${(0x0c / 255).toFixed(3)} rg`;

  // cm sets the image's box; Do paints it. The unit square is scaled to the
  // fitted size and shifted to centre it, leaving the margin clear.
  const content =
    `${field} 0 0 ${PAGE_W} ${PAGE_H} re f\n` +
    `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm /Im0 Do Q\n`;
  startObject(5, `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefAt = length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const pdf = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    pdf.set(c, at);
    at += c.length;
  }
  return pdf;
}
