// Listing photo checks that need no image library: the file type is decided
// from its bytes (never the client's Content-Type or filename), dimensions are
// read from the header, and metadata that can reveal a private location (EXIF
// GPS, XMP, IPTC, text chunks) is removed before anything is stored.

export type ImageType = "image/jpeg" | "image/png";

export const MAX_IMAGE_DIMENSION = 8000;
export const MIN_IMAGE_DIMENSION = 200;

export class ImageError extends Error {
  constructor(public readonly code: "unsupported_image" | "invalid_image" | "image_dimensions", message: string) {
    super(message);
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  return null;
}

// JPEG markers dropped: APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), COM (comments).
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);
// Start-of-frame markers carrying dimensions (excluding DHT/JPG/DAC).
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(buf: Buffer): { data: Buffer; width: number; height: number } {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new ImageError("invalid_image", "The JPEG file is malformed");
    const marker = buf[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) throw new ImageError("invalid_image", "The JPEG file is truncated");
    const len = buf.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > buf.length) throw new ImageError("invalid_image", "The JPEG file is truncated");
    if (JPEG_SOF.has(marker) && len >= 7) {
      height = buf.readUInt16BE(i + 5);
      width = buf.readUInt16BE(i + 7);
    }
    if (marker === 0xda) {
      // Start of scan: the compressed image data runs to the end of the file.
      out.push(buf.subarray(i));
      return { data: Buffer.concat(out), width, height };
    }
    if (!JPEG_DROP.has(marker)) out.push(buf.subarray(i, end));
    i = end;
  }
  throw new ImageError("invalid_image", "The JPEG file has no image data");
}

const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

function cleanPng(buf: Buffer): { data: Buffer; width: number; height: number } {
  const out: Buffer[] = [PNG_SIGNATURE];
  let i = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new ImageError("invalid_image", "The PNG file is truncated");
    if (type === "IHDR") {
      width = buf.readUInt32BE(i + 8);
      height = buf.readUInt32BE(i + 12);
    }
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !width) throw new ImageError("invalid_image", "The PNG file is malformed");
  return { data: Buffer.concat(out), width, height };
}

/** Validates and strips a listing photo. Throws ImageError when it isn't acceptable. */
export function prepareListingImage(buf: Buffer): { type: ImageType; data: Buffer; width: number; height: number } {
  const type = sniffImageType(buf);
  if (!type) throw new ImageError("unsupported_image", "Upload a JPEG or PNG image");
  const { data, width, height } = type === "image/jpeg" ? cleanJpeg(buf) : cleanPng(buf);
  if (!width || !height) throw new ImageError("invalid_image", "Couldn't read the image dimensions");
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ImageError("image_dimensions", `Images can be at most ${MAX_IMAGE_DIMENSION}px on each side`);
  }
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    throw new ImageError("image_dimensions", `Images must be at least ${MIN_IMAGE_DIMENSION}px on each side`);
  }
  return { type, data, width, height };
}
