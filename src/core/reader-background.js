window.OD = window.OD || {};

/*
  Custom background: the reader's own image, laid on the surface beneath the
  page. It is not a fourth theme — Paper, Mist, and Night keep owning paper,
  ink, panels, and shadows, and the image sits underneath all of them.

  This module holds the parts worth testing: the settings contract and the
  style each setting produces. The bytes live elsewhere — a processed Blob in
  its own IndexedDB record, never in reader settings, because settings are
  mirrored into localStorage and a fat image there would silently break the
  mirror that also carries bookmarks, highlights, and reading progress.
*/
(function(OD){
  // One record beside the reader-settings record, in the store that already
  // exists. Blobs must not pass through the settings clone, which strips them.
  const ASSET_KEY = "background-image";

  const FITS = ["fill", "contain", "tile"];
  const TARGETS = ["outer", "paper"];

  // A phone photo is 12-30MB; the stage never needs more than this.
  const MAX_EDGE = 2560;
  const QUALITY = 0.85;

  const DEFAULTS = {
    enabled: false,
    assetId: null,
    target: "outer",
    fit: "fill",
    focusX: 50,
    focusY: 50,
    // Percent. Below 100 the image recedes so text keeps the foreground.
    brightness: 78,
    // Pixels of blur. Softness only ever reduces detail — it cannot add any,
    // which is why this is not called sharpness.
    softness: 4
  };

  const BRIGHTNESS_RANGE = [40, 120];
  const SOFTNESS_RANGE = [0, 16];

  function clamp(value, min, max, fallback) {
    // Number(null) is 0 and Number("") is 0, but neither is someone asking
    // for zero — an absent value means the default, an explicit 0 means 0.
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalize(value) {
    const input = value && typeof value === "object" ? value : {};
    const assetId = typeof input.assetId === "string" && input.assetId.trim()
      ? input.assetId.trim()
      : DEFAULTS.assetId;
    return {
      enabled: input.enabled === true,
      assetId,
      target: TARGETS.includes(input.target) ? input.target : DEFAULTS.target,
      fit: FITS.includes(input.fit) ? input.fit : DEFAULTS.fit,
      focusX: clamp(input.focusX, 0, 100, DEFAULTS.focusX),
      focusY: clamp(input.focusY, 0, 100, DEFAULTS.focusY),
      brightness: clamp(input.brightness, BRIGHTNESS_RANGE[0], BRIGHTNESS_RANGE[1], DEFAULTS.brightness),
      softness: clamp(input.softness, SOFTNESS_RANGE[0], SOFTNESS_RANGE[1], DEFAULTS.softness)
    };
  }

  // An image only shows when it is switched on and there is one to show.
  // Disabling keeps the image and the settings; removing is a separate act.
  function isActive(settings) {
    const normalized = normalize(settings);
    return normalized.enabled && !!normalized.assetId;
  }

  /*
    What the isolated layer should look like. Brightness and blur are applied
    to that layer alone — it holds no Reader descendants, so the reading paper
    can never be dimmed by accident.
  */
  function layerStyle(settings) {
    const normalized = normalize(settings);
    const size = normalized.fit === "fill" ? "cover" : normalized.fit === "contain" ? "contain" : "auto";
    const filters = [`brightness(${normalized.brightness}%)`];
    if (normalized.softness > 0) filters.push(`blur(${normalized.softness}px)`);
    return {
      backgroundSize: size,
      backgroundRepeat: normalized.fit === "tile" ? "repeat" : "no-repeat",
      // Tiling has no focal point; the pattern starts at the corner.
      backgroundPosition: normalized.fit === "tile" ? "0% 0%" : `${normalized.focusX}% ${normalized.focusY}%`,
      filter: filters.join(" "),
      // Blur samples past the edge, so the layer overscans rather than
      // fading to transparent along the sides.
      overscan: normalized.softness > 0 ? Math.ceil(normalized.softness * 3) : 0
    };
  }

  // Longest edge capped, aspect ratio kept. Returns the size to draw at.
  function scaleToFit(width, height, maxEdge = MAX_EDGE) {
    const w = Math.max(1, Math.round(Number(width) || 0));
    const h = Math.max(1, Math.round(Number(height) || 0));
    const longest = Math.max(w, h);
    if (longest <= maxEdge) return { width: w, height: h, scaled: false };
    const ratio = maxEdge / longest;
    return {
      width: Math.max(1, Math.round(w * ratio)),
      height: Math.max(1, Math.round(h * ratio)),
      scaled: true
    };
  }

  OD.readerBackground = {
    ASSET_KEY,
    DEFAULTS,
    FITS,
    TARGETS,
    MAX_EDGE,
    QUALITY,
    BRIGHTNESS_RANGE,
    SOFTNESS_RANGE,
    normalize,
    isActive,
    layerStyle,
    scaleToFit
  };
})(window.OD);
