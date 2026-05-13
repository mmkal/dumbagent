export type AttachmentSource = "file" | "paste" | "drop";

export function attachmentUploadName(file: File, source: AttachmentSource, now = Date.now) {
  if (source === "paste" && file.type.startsWith("image/")) {
    return `screenshot-${now()}.png`;
  }
  if (file.name) {
    return file.name;
  }
  if (file.type === "image/png") {
    return "image.png";
  }
  if (file.type === "image/jpeg") {
    return "image.jpg";
  }
  if (file.type === "image/webp") {
    return "image.webp";
  }
  if (file.type === "image/gif") {
    return "image.gif";
  }
  return "attachment";
}

export function dedupeClipboardImageFiles(files: File[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.type}:${file.size}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
