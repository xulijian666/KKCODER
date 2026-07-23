/** Last path segment of a filesystem path (handles trailing separators). */
export function getFolderName(path: string): string {
  if (!path) return "";
  const cleanedPath = path.replace(/[\\/]+$/, "");
  const parts = cleanedPath.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
