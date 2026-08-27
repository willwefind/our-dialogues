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
    // Percent, where 100 is the image exactly as sharp as it arrived. The
    // slider can only take detail away — it never promises to add any, which
    // is why 100 is the ceiling rather than the middle.
    clarity: 75,
    // Percent. How much of the reading paper still veils the image when the
    // image is on the paper: 100 keeps the sheet as it always was, 0 lets the
    // words sit straight on the picture.
    paperOpacity: 74
  };

  const BRIGHTNESS_RANGE = [40, 120];
  const CLARITY_RANGE = [0, 100];
  const PAPER_OPACITY_RANGE = [0, 100];
  // Clarity 0 blurs by this much; every step in between is proportional.
  const MAX_BLUR = 16;

  function clamp(value, min, max, fallback) {
    // Number(null) is 0 and Number("") is 0, but neither is someone asking
    // for zero — an absent value means the default, an explicit 0 means 0.
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  // Earlier builds stored blur pixels under `softness`; the same intent reads
  // as clarity from the other end, so old settings convert instead of resetting.
  function clarityFrom(input) {
    if (input.clarity !== undefined && input.clarity !== null && input.clarity !== "") return input.clarity;
    const softness = Number(input.softness);
    if (Number.isFinite(softness)) return Math.round(100 - (softness / MAX_BLUR) * 100);
    return DEFAULTS.clarity;
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
      clarity: clamp(clarityFrom(input), CLARITY_RANGE[0], CLARITY_RANGE[1], DEFAULTS.clarity),
      paperOpacity: clamp(input.paperOpacity, PAPER_OPACITY_RANGE[0], PAPER_OPACITY_RANGE[1], DEFAULTS.paperOpacity)
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
  const TILE_WIDTH_PERCENT = 33.333;

  function blurFor(clarity) {
    return Math.round(((100 - clarity) / 100) * MAX_BLUR);
  }

  function layerStyle(settings) {
    const normalized = normalize(settings);
    // Tiling at the picture's own size never tiles: the upload pipeline caps
    // the long edge at 2560, which is wider than any reading surface. A third
    // of the layer keeps the repeat visible and identical on every screen.
    const size = normalized.fit === "fill" ? "cover"
      : normalized.fit === "contain" ? "contain" : `${TILE_WIDTH_PERCENT}% auto`;
    const blur = blurFor(normalized.clarity);
    const filters = [`brightness(${normalized.brightness}%)`];
    if (blur > 0) filters.push(`blur(${blur}px)`);
    return {
      backgroundSize: size,
      backgroundRepeat: normalized.fit === "tile" ? "repeat" : "no-repeat",
      // Tiling has no focal point; the pattern starts at the corner.
      backgroundPosition: normalized.fit === "tile" ? "0% 0%" : `${normalized.focusX}% ${normalized.focusY}%`,
      filter: filters.join(" "),
      // Blur samples past the edge, so the layer overscans rather than
      // fading to transparent along the sides.
      overscan: blur > 0 ? Math.ceil(blur * 3) : 0
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
    CLARITY_RANGE,
    PAPER_OPACITY_RANGE,
    MAX_BLUR,
    blurFor,
    normalize,
    isActive,
    layerStyle,
    scaleToFit
  };
})(window.OD);
