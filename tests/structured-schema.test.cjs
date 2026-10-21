const test = require("node:test");
const assert = require("node:assert/strict");
const { toStructuredSchema } = require("../.test-build/lib/anthropic.js");

// Structured outputs reject several JSON Schema keywords with a 400. The
// schemas in lib/ are written with those limits for the reader's sake,
// and narrowed by toStructuredSchema before they are sent.

const sample = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 5,
      minItems: 0,
      description: "Things to do.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 80 },
          source: { type: "string", enum: ["email", "calendar", "both"] },
        },
        required: ["title", "source"],
      },
    },
    count: { type: "integer", minimum: 0, maximum: 9 },
  },
  required: ["items"],
};

function walk(schema, visit) {
  visit(schema);
  if (schema.properties) Object.values(schema.properties).forEach((s) => walk(s, visit));
  if (schema.items) walk(schema.items, visit);
}

test("every object is closed with additionalProperties: false", () => {
  walk(toStructuredSchema(sample), (s) => {
    if (s.type === "object") assert.equal(s.additionalProperties, false);
  });
});

test("unsupported keywords are removed but kept in the description", () => {
  const out = toStructuredSchema(sample);
  const items = out.properties.items;
  assert.equal(items.maxItems, undefined);
  assert.equal(items.minItems, 0, "minItems 0 is supported and stays");
  assert.match(items.description, /^Things to do\. \(maxItems: 5\)$/);
  assert.equal(items.items.properties.title.maxLength, undefined);
  assert.match(items.items.properties.title.description, /maxLength: 80/);
  const count = out.properties.count;
  assert.equal(count.minimum, undefined);
  assert.equal(count.maximum, undefined);
});

test("enum and required survive, because they are supported", () => {
  const out = toStructuredSchema(sample);
  assert.deepEqual(out.required, ["items"]);
  assert.deepEqual(out.properties.items.items.properties.source.enum, [
    "email",
    "calendar",
    "both",
  ]);
});

test("minItems above 1 is not supported and is moved to the description", () => {
  const out = toStructuredSchema({ type: "array", minItems: 2, items: { type: "string" } });
  assert.equal(out.minItems, undefined);
  assert.match(out.description, /minItems: 2/);
});

test("the input schema is not mutated", () => {
  const copy = JSON.parse(JSON.stringify(sample));
  toStructuredSchema(sample);
  assert.deepEqual(sample, copy);
});
