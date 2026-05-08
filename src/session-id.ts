import { randomUUID } from "node:crypto";

export function createSessionId() {
  return `tuiui_${randomUUID().replaceAll("-", "")}`;
}
