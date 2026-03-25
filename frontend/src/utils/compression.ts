// File compression/decompression using web-standard CompressionStream API

/** Check if CompressionStream API is available */
export function isCompressionSupported(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/**
 * Compress a File using gzip and compute SHA-256 checksum of the original.
 * Falls back to no compression if CompressionStream is not available.
 */
export async function compressFile(
  file: File,
): Promise<{ compressed: Blob; checksum: string; originalSize: number }> {
  const originalBytes = await file.arrayBuffer();

  // Compute SHA-256 of original file
  const hashBuffer = await crypto.subtle.digest("SHA-256", originalBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const checksum = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  if (!isCompressionSupported()) {
    // Fallback: send uncompressed
    return { compressed: new Blob([originalBytes]), checksum, originalSize: file.size };
  }

  // Compress using CompressionStream
  const compressedResponse = await new Response(
    new Blob([originalBytes]).stream().pipeThrough(new CompressionStream("gzip"))
  ).blob();

  return { compressed: compressedResponse, checksum, originalSize: file.size };
}

/**
 * Decompress a gzip Blob and verify SHA-256 checksum.
 * Throws if checksum doesn't match.
 */
export async function decompressBlob(
  compressed: Blob,
  expectedChecksum: string
): Promise<Blob> {
  if (!isCompressionSupported()) {
    // Can't decompress — verify checksum on raw data
    const rawBytes = await compressed.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actual = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    if (actual !== expectedChecksum) {
      throw new Error(`Checksum mismatch`);
    }
    return compressed;
  }

  const decompressedResponse = await new Response(
    compressed.stream().pipeThrough(new DecompressionStream("gzip"))
  ).blob();

  // Verify checksum
  const resultBytes = await decompressedResponse.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", resultBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const actualChecksum = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch: expected ${expectedChecksum.slice(0, 16)}..., got ${actualChecksum.slice(0, 16)}...`
    );
  }

  return decompressedResponse;
}
