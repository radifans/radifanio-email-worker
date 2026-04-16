const UNSAFE_CHARS = /[<>:"|?*\x00-\x1f]/g;
const MAX_FILENAME_LENGTH = 200;

export function sanitizeFilename(filename: string): string {
  let name = filename.trim();

  if (!name) return "unnamed";

  // Remove path traversal
  name = name.replace(/\.\.[/\\]/g, "");
  // Take only the last path segment
  name = name.split(/[/\\]/).pop() || "unnamed";
  // Strip leading dots and spaces
  name = name.replace(/^[\s.]+/, "");
  // Replace unsafe characters
  name = name.replace(UNSAFE_CHARS, "_");

  if (!name) return "unnamed";

  // Truncate preserving extension
  if (name.length > MAX_FILENAME_LENGTH) {
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex > 0) {
      const ext = name.slice(dotIndex);
      const base = name.slice(0, MAX_FILENAME_LENGTH - ext.length);
      name = base + ext;
    } else {
      name = name.slice(0, MAX_FILENAME_LENGTH);
    }
  }

  return name;
}

export function deduplicateFilename(
  filename: string,
  existingNames: string[]
): string {
  if (!existingNames.includes(filename)) return filename;

  const dotIndex = filename.lastIndexOf(".");
  const hasExt = dotIndex > 0;
  const base = hasExt ? filename.slice(0, dotIndex) : filename;
  const ext = hasExt ? filename.slice(dotIndex) : "";

  let counter = 1;
  while (existingNames.includes(`${base}-${counter}${ext}`)) {
    counter++;
  }

  return `${base}-${counter}${ext}`;
}
