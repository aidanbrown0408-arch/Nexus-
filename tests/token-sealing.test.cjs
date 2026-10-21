const test = require("node:test");
const assert = require("node:assert/strict");

// Google tokens are sealed at rest, but rows written before that change
// are plaintext. Both have to keep working.

function load(env) {
  for (const k of ["TOKEN_ENCRYPTION_KEY", "APPLE_ENCRYPTION_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
  const path = require.resolve("../.test-build/lib/crypto.js");
  delete require.cache[path];
  return require(path);
}

const KEY = Buffer.alloc(32, 7).toString("base64");

test("a sealed token opens back to the original", () => {
  const c = load({ TOKEN_ENCRYPTION_KEY: KEY });
  const sealed = c.sealSecret("ya29.example-token");
  assert.notEqual(sealed, "ya29.example-token");
  assert.ok(c.isSealed(sealed));
  assert.equal(c.openSecret(sealed), "ya29.example-token");
});

test("a legacy plaintext token is read as-is", () => {
  const c = load({ TOKEN_ENCRYPTION_KEY: KEY });
  assert.equal(c.openSecret("1//legacy-refresh"), "1//legacy-refresh");
  assert.equal(c.isSealed("1//legacy-refresh"), false);
});

test("without a key, sealing is a no-op rather than a crash", () => {
  const c = load({});
  assert.equal(c.sealSecret("ya29.x"), "ya29.x");
});

test("APPLE_ENCRYPTION_KEY still works as the key", () => {
  const sealedWithApple = load({ APPLE_ENCRYPTION_KEY: KEY }).sealSecret("secret");
  const c = load({ TOKEN_ENCRYPTION_KEY: KEY });
  assert.equal(c.openSecret(sealedWithApple), "secret");
});

test("empty values pass through", () => {
  const c = load({ TOKEN_ENCRYPTION_KEY: KEY });
  assert.equal(c.sealSecret(""), "");
  assert.equal(c.openSecret(""), "");
});
