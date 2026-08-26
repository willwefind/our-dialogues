import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plain = value => JSON.parse(JSON.stringify(value));

async function loadBackground() {
  const runtime = { console };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "reader-background.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/reader-background.js" });
  return runtime.OD.readerBackground;
}

test("fresh settings start disabled with no image and the approved defaults", async () => {
  const background = await loadBackground();
  assert.deepEqual(plain(background.normalize(undefined)), {
    enabled: false, assetId: null, target: "outer", fit: "fill",
    focusX: 50, focusY: 50, brightness: 78, softness: 4
  });
});

test("unknown targets and fits fall back rather than reaching the stylesheet", async () => {
  const background = await loadBackground();
  const settings = background.normalize({ target: "ceiling", fit: "stretch", assetId: "   " });
  assert.equal(settings.target, "outer");
  assert.equal(settings.fit, "fill");
  assert.equal(settings.assetId, null);
});

test("brightness and softness are clamped to their approved ranges", async () => {
  const background = await loadBackground();
  assert.equal(background.normalize({ brightness: 5 }).brightness, 40);
  assert.equal(background.normalize({ brightness: 400 }).brightness, 120);
  assert.equal(background.normalize({ softness: -3 }).softness, 0);
  assert.equal(background.normalize({ softness: 99 }).softness, 16);
  // Nonsense falls back to the default instead of poisoning the layer.
  assert.equal(background.normalize({ brightness: "bright" }).brightness, 78);
  assert.equal(background.normalize({ softness: null }).softness, 4);
  assert.equal(background.normalize({ focusX: 999, focusY: -20 }).focusX, 100);
  assert.equal(background.normalize({ focusX: 999, focusY: -20 }).focusY, 0);
});

test("an image only shows when it is both switched on and present", async () => {
  const background = await loadBackground();
  assert.equal(background.isActive({ enabled: true, assetId: "bg-1" }), true);
  // Disabling keeps the image; it just stops showing.
  assert.equal(background.isActive({ enabled: false, assetId: "bg-1" }), false);
  assert.equal(background.isActive({ enabled: true, assetId: null }), false);
  assert.equal(background.isActive(undefined), false);
});

test("fit maps to the three approved behaviours", async () => {
  const background = await loadBackground();
  const fill = background.layerStyle({ fit: "fill", focusX: 20, focusY: 80 });
  assert.equal(fill.backgroundSize, "cover");
  assert.equal(fill.backgroundRepeat, "no-repeat");
  assert.equal(fill.backgroundPosition, "20% 80%");

  const contain = background.layerStyle({ fit: "contain" });
  assert.equal(contain.backgroundSize, "contain");
  assert.equal(contain.backgroundRepeat, "no-repeat");

  // A tiled pattern has no focal point to honour.
  const tile = background.layerStyle({ fit: "tile", focusX: 0, focusY: 100 });
  assert.equal(tile.backgroundSize, "auto");
  assert.equal(tile.backgroundRepeat, "repeat");
  assert.equal(tile.backgroundPosition, "0% 0%");
});

test("brightness and softness compose into one filter on the isolated layer", async () => {
  const background = await loadBackground();
  assert.equal(background.layerStyle({ brightness: 78, softness: 4 }).filter, "brightness(78%) blur(4px)");
  // No blur means no blur function at all, so the layer stays cheap.
  assert.equal(background.layerStyle({ brightness: 100, softness: 0 }).filter, "brightness(100%)");
});

test("a blurred layer overscans so its edges cannot fade to nothing", async () => {
  const background = await loadBackground();
  assert.equal(background.layerStyle({ softness: 0 }).overscan, 0);
  assert.ok(background.layerStyle({ softness: 4 }).overscan >= 8);
  assert.ok(background.layerStyle({ softness: 16 }).overscan >= 32);
});

test("oversized photos scale down by the longest edge, keeping their shape", async () => {
  const background = await loadBackground();
  // A 12MP phone photo.
  const shrunk = background.scaleToFit(4032, 3024);
  assert.equal(shrunk.scaled, true);
  assert.equal(shrunk.width, background.MAX_EDGE);
  assert.ok(Math.abs(shrunk.width / shrunk.height - 4032 / 3024) < 0.01);
  // Portrait orientation caps on height instead.
  const portrait = background.scaleToFit(1080, 3840);
  assert.equal(portrait.height, background.MAX_EDGE);
  // Anything already small is left alone rather than re-encoded larger.
  const small = background.scaleToFit(1200, 800);
  assert.deepEqual(plain(small), { width: 1200, height: 800, scaled: false });
});

test("the asset key is separate from the reader-settings record", async () => {
  const background = await loadBackground();
  assert.equal(typeof background.ASSET_KEY, "string");
  assert.ok(background.ASSET_KEY.length > 0);
  assert.notEqual(background.ASSET_KEY, "reader");
});
