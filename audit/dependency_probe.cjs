// Run with Node: node audit/dependency_probe.cjs. No application server is used.
const braces = require("../frontend/node_modules/braces");
const fs = require("node:fs");
const path = require("node:path");
const probes = [4900].map((depth) => {
  const input = "{".repeat(depth) + "x" + "}".repeat(depth);
  try {
    braces(input);
    return { depth, input_length: input.length, status: "PASS", result: "accepted" };
  } catch (e) {
    return { depth, input_length: input.length, status: e instanceof RangeError ? "FINDING" : "PASS", result: e.name + ": " + e.message };
  }
});
const result = { node_version: process.version, package_version: require("../frontend/node_modules/braces/package.json").version, probes };
fs.writeFileSync(path.join(__dirname, "node-dependency-probes.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
