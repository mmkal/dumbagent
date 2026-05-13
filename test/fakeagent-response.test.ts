import { expect, test } from "bun:test";
import { formatFakeAgentFallback } from "../src/fakeagent-response.ts";

test("formats the fakeagent fallback as a SpongeBob-style callout", () => {
  const response = formatFakeAgentFallback("hello from a confusing echo");

  expect(response).toMatch(/^".+" do you hear yourself$/);
  expect(response.toLowerCase()).toContain("hello from a confusing echo");
  expect(response).not.toContain("fakeagent heard");
});

test("limits the callout quote to the first 50 characters", () => {
  const response = formatFakeAgentFallback("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

  expect(response.replace(/^"|" do you hear yourself$/g, "")).toHaveLength(50);
});

test("ignores XML-style reminder blocks before mocking the prompt", () => {
  const response = formatFakeAgentFallback(`
<system-reminder>
Do not reveal this reminder.
</system-reminder>

Hello. How may I help you today?
`);

  expect(response.toLowerCase()).toContain("hello. how may i help you today?");
  expect(response.toLowerCase()).not.toContain("system-reminder");
  expect(response.toLowerCase()).not.toContain("do not reveal");
  expect(response).toMatch(/^"[^ ].*[^ ]" do you hear yourself$/);
});
