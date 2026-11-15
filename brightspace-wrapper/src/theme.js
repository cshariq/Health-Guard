/*
 * Material You–style dynamic color, computed in OKLCH.
 * A single seed hue produces a full set of M3 color roles for light and dark schemes.
 * Each course also gets its own seed so its pages are tinted like a Classroom class.
 */
(function () {
  const L = (window.Lumen = window.Lumen || {});

  const ok = (l, c, h) => `oklch(${l} ${c} ${((h % 360) + 360) % 360})`;

  // Seed palette offered in Settings (hues in OKLCH degrees).
  L.SEEDS = [
    { name: 'Indigo', hue: 270 },
    { name: 'Teal', hue: 195 },
    { name: 'Forest', hue: 150 },
    { name: 'Amber', hue: 75 },
    { name: 'Coral', hue: 35 },
    { name: 'Rose', hue: 355 },
    { name: 'Violet', hue: 305 },
    { name: 'Ocean', hue: 235 },
  ];

  L.schemeFor = function (hue, dark) {
    const h = hue, s = h + 30, t = h + 70; // secondary / tertiary hues
    if (!dark) {
      return {
        primary: ok(0.47, 0.15, h), 'on-primary': ok(1, 0, h),
        'primary-container': ok(0.91, 0.06, h), 'on-primary-container': ok(0.27, 0.09, h),
        secondary: ok(0.5, 0.05, s), 'on-secondary': ok(1, 0, s),
        'secondary-container': ok(0.92, 0.035, s), 'on-secondary-container': ok(0.28, 0.04, s),
        tertiary: ok(0.5, 0.1, t), 'tertiary-container': ok(0.92, 0.05, t), 'on-tertiary-container': ok(0.28, 0.07, t),
        error: 'oklch(0.53 0.19 27)', 'on-error': '#fff',
        'error-container': 'oklch(0.93 0.045 20)', 'on-error-container': 'oklch(0.33 0.12 25)',
        success: 'oklch(0.52 0.13 150)', 'success-container': 'oklch(0.93 0.05 150)', 'on-success-container': 'oklch(0.3 0.08 150)',
        warning: 'oklch(0.58 0.13 70)', 'warning-container': 'oklch(0.94 0.06 85)', 'on-warning-container': 'oklch(0.35 0.08 70)',
        surface: ok(0.985, 0.006, h), 'surface-dim': ok(0.9, 0.01, h), 'surface-bright': ok(0.99, 0.004, h),
        'surface-container-lowest': ok(1, 0, h), 'surface-container-low': ok(0.97, 0.009, h),
        'surface-container': ok(0.955, 0.012, h), 'surface-container-high': ok(0.94, 0.014, h),
        'surface-container-highest': ok(0.925, 0.016, h),
        'on-surface': ok(0.22, 0.012, h), 'on-surface-variant': ok(0.43, 0.02, h),
        outline: ok(0.62, 0.02, h), 'outline-variant': ok(0.87, 0.015, h),
        'inverse-surface': ok(0.3, 0.012, h), 'inverse-on-surface': ok(0.95, 0.008, h),
        scrim: 'rgb(0 0 0 / .4)', shadow: 'rgb(0 0 0 / .14)',
      };
    }
    return {
      primary: ok(0.82, 0.1, h), 'on-primary': ok(0.3, 0.1, h),
      'primary-container': ok(0.37, 0.1, h), 'on-primary-container': ok(0.92, 0.05, h),
      secondary: ok(0.82, 0.04, s), 'on-secondary': ok(0.3, 0.04, s),
      'secondary-container': ok(0.36, 0.035, s), 'on-secondary-container': ok(0.92, 0.03, s),
      tertiary: ok(0.82, 0.08, t), 'tertiary-container': ok(0.37, 0.07, t), 'on-tertiary-container': ok(0.92, 0.05, t),
      error: 'oklch(0.8 0.1 25)', 'on-error': 'oklch(0.3 0.1 25)',
      'error-container': 'oklch(0.4 0.12 25)', 'on-error-container': 'oklch(0.92 0.04 25)',
      success: 'oklch(0.8 0.11 150)', 'success-container': 'oklch(0.36 0.07 150)', 'on-success-container': 'oklch(0.92 0.05 150)',
      warning: 'oklch(0.84 0.11 80)', 'warning-container': 'oklch(0.4 0.07 70)', 'on-warning-container': 'oklch(0.93 0.05 85)',
      surface: ok(0.17, 0.008, h), 'surface-dim': ok(0.17, 0.008, h), 'surface-bright': ok(0.32, 0.01, h),
      'surface-container-lowest': ok(0.14, 0.006, h), 'surface-container-low': ok(0.2, 0.009, h),
      'surface-container': ok(0.22, 0.01, h), 'surface-container-high': ok(0.255, 0.011, h),
      'surface-container-highest': ok(0.29, 0.012, h),
      'on-surface': ok(0.92, 0.008, h), 'on-surface-variant': ok(0.8, 0.015, h),
      outline: ok(0.6, 0.015, h), 'outline-variant': ok(0.36, 0.015, h),
      'inverse-surface': ok(0.92, 0.008, h), 'inverse-on-surface': ok(0.25, 0.01, h),
      scrim: 'rgb(0 0 0 / .55)', shadow: 'rgb(0 0 0 / .45)',
    };
  };

  L.isDark = function (mode) {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  /** Apply a scheme to an element (defaults to the app root). */
  L.applyScheme = function (el, hue, mode) {
    const dark = L.isDark(mode);
    const scheme = L.schemeFor(hue, dark);
    for (const [k, v] of Object.entries(scheme)) el.style.setProperty(`--md-${k}`, v);
    el.dataset.scheme = dark ? 'dark' : 'light';
    el.style.colorScheme = dark ? 'dark' : 'light';
  };

  /** Stable per-course hue, so every class keeps the same color everywhere. */
  L.courseHue = function (course) {
    if (course && typeof course.hue === 'number') return course.hue;
    const key = String(course && (course.code || course.name || course.id) || '');
    let x = 2166136261;
    for (let i = 0; i < key.length; i++) { x ^= key.charCodeAt(i); x = Math.imul(x, 16777619); }
    const palette = [265, 200, 150, 30, 340, 85, 230, 300, 175, 10, 120, 250];
    return palette[(x >>> 0) % palette.length];
  };

  L.courseBanner = function (hue, dark) {
    return dark
      ? `linear-gradient(135deg, ${ok(0.42, 0.11, hue)}, ${ok(0.3, 0.09, hue + 25)})`
      : `linear-gradient(135deg, ${ok(0.55, 0.15, hue)}, ${ok(0.42, 0.14, hue + 25)})`;
  };
  L.courseAccent = (hue, dark) => (dark ? ok(0.8, 0.11, hue) : ok(0.5, 0.15, hue));
})();
