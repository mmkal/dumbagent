import { expect, test } from "bun:test";
import { attachmentUploadName } from "../client/attachments.ts";

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
