import { expect, test } from "bun:test";
import { attachmentUploadName, dedupeClipboardImageFiles } from "../client/attachments.ts";

test("names pasted images as timestamped screenshots", () => {
  expect(attachmentUploadName(
    new File(["image"], "image.png", { type: "image/png" }),
    "paste",
    () => 12345,
  )).toBe("screenshot-12345.png");

  expect(attachmentUploadName(
    new File(["text"], "notes.txt", { type: "text/plain" }),
    "paste",
    () => 12345,
  )).toBe("notes.txt");
});

test("preserves picked and dropped file names", () => {
  const file = new File(["image"], "image.png", { type: "image/png" });

  expect(attachmentUploadName(file, "file", () => 12345)).toBe("image.png");
  expect(attachmentUploadName(file, "drop", () => 12345)).toBe("image.png");
});

test("deduplicates clipboard image files exposed through multiple clipboard views", () => {
  const files = dedupeClipboardImageFiles([
    new File(["image"], "image.png", { type: "image/png", lastModified: 1 }),
    new File(["image"], "screenshot.png", { type: "image/png", lastModified: 2 }),
    new File(["other image"], "other.png", { type: "image/png", lastModified: 3 }),
  ]);

  expect(files.map((file) => file.name)).toEqual(["image.png", "other.png"]);
});
