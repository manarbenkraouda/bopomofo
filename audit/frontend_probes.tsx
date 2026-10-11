// Static rendering checks. This file does not start or change the app.
import React from "../frontend/node_modules/react";
import { renderToStaticMarkup } from "../frontend/node_modules/react-dom/server";
import { Text, Chips, Cta } from "../frontend/src/components/story/blocks/text";
import { writeFileSync } from "node:fs";

const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
const ctx = {} as never;
const cases = [
  ["LLM story text", <Text props={{ text: payload }} ctx={ctx} delay={0} onAction={() => {}} />],
  ["LLM chips", <Chips props={{ items: [payload] }} ctx={ctx} delay={0} onAction={() => {}} />],
  ["LLM CTA label", <Cta props={{ label: payload, action: "close" }} ctx={ctx} delay={0} onAction={() => {}} />],
] as const;
const probes = cases.map(([name, el]) => {
  const html = renderToStaticMarkup(el);
  return { name, status: !html.includes("<script>") && !html.includes("<img") && html.includes("&lt;") ? "PASS" : "FINDING", html };
});
const braces = require("../frontend/node_modules/braces");
try {
  braces("{".repeat(4900) + "x" + "}".repeat(4900));
  probes.push({ name: "braces deeply nested pattern", status: "PASS", html: "No exception for the selected input; advisory remains applicable." });
} catch (e) {
  probes.push({ name: "braces deeply nested pattern", status: e instanceof RangeError ? "FINDING" : "PASS", html: (e as Error).name + ": " + (e as Error).message });
}
writeFileSync(new URL("frontend-probes.json", import.meta.url), JSON.stringify({ note: "Static React rendering and an isolated dependency probe; no browser XSS execution test.", probes }, null, 2));
console.log(probes.map(({ name, status }) => ({ name, status })));
