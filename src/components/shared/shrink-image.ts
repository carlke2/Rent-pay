/**
 * Browser-side photo shrinking before upload. Vercel rejects request bodies over 4.5 MB, and phone photos are
 * often bigger, so uploads are kept under `targetBytes`: at most `maxSide` px on the long side, WebP (JPEG where
 * the browser can't encode WebP), lowering quality until it fits. EXIF orientation is applied while decoding.
 * Throws if the browser can't decode the image (e.g. HEIC outside Safari) or it can't be made small enough.
 */
export async function shrinkImage(file: File, { maxSide, targetBytes }: { maxSide: number; targetBytes: number }): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas not available");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const toBlob = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    let blob = await toBlob("image/webp", quality);
    // Older Safari silently returns PNG for WebP: fall back to JPEG.
    if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", quality);
    if (blob && blob.size <= targetBytes) {
      const extension = blob.type === "image/webp" ? "webp" : "jpg";
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.${extension}`, { type: blob.type });
    }
  }
  throw new Error("Photo still too large after compressing");
}
