/**
 * QR Code generation utilities
 */

/**
 * Generate QR code data (path only, without domain)
 * @param errorItemId - The error item ID
 * @returns The path to the error item
 */
export function generateQRCodeData(errorItemId: string): string {
  return `/error-items/${errorItemId}`;
}

/**
 * Get full URL from QR code data
 * @param path - The path from QR code
 * @returns Full URL with current origin
 */
export function getFullQRCodeURL(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * Validate if a scanned path is a valid error item path
 * @param path - The scanned path
 * @returns True if valid
 */
export function isValidErrorItemPath(path: string): boolean {
  return /^\/error-items\/[a-z0-9]{24}$/.test(path);
}
