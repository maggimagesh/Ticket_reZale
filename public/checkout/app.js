/* ============================================================
   Checkout — payment method
   No storage, no network, no dependencies.
   The CVC is read for validation and immediately discarded; it is
   never assigned to a variable that outlives the call, never
   logged, and is wiped from the DOM the moment the form is sent.
   ============================================================ */

(function () {
  'use strict';

  /* ── tiny helpers ─────────────────────────────────────── */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var isDigit = function (ch) { return ch >= '0' && ch <= '9'; };

  var TOTAL_CENTS = 124800;
  var money = function (cents) {
    return '$' + (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  };

  var APPROVE_PAN = '4242424242424242';
  var SETTLE_MS = 1400;

  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = function () { return reduceMQ.matches; };

  /* ── elements ─────────────────────────────────────────── */

  var panel   = $('#panel');
  var slot    = $('#cardSlot');      // never transformed — the measuring reference
  var card    = $('#card');          // carries the FLIP transform
  var tilt    = $('#cardTilt');      // carries the pointer tilt
  var inner   = $('#cardInner');     // carries the 180° flip
  var glow    = $('#glow');

  var panOut  = $('#panOut');
  var nameOut = $('#nameOut');
  var expOut  = $('#expOut');
  var cvcOut  = $('#cvcOut');

  var sheen      = $('#cardSheen');
  var brandCard  = $('#brandCard');
  var brandBack  = $('#brandBack');
  var brandField = $('#brandField');

  var form    = $('#payForm');
  var nameEl  = $('#ccName');
  var numEl   = $('#ccNumber');
  var expEl   = $('#ccExp');
  var cvcEl   = $('#ccCvc');
  var payBtn  = $('#payBtn');

  var stage       = $('#stage');
  var zone        = $('#stageZone');
  var ind         = $('#ind');
  var stageHead   = $('#stageHead');
  var stageSub    = $('#stageSub');
  var stageReason = $('#stageReason');
  var againBtn    = $('#againBtn');
  var retryBtn    = $('#retryBtn');

  var live = $('#live');

  /* ── brands ───────────────────────────────────────────── */

  var UNKNOWN = {
    id: 'unknown', label: 'Card',
    groups: [4, 4, 4, 4], lengths: [12,13,14,15,16,17,18,19], cvc: [3, 4], max: 19
  };

  var BRANDS = [
    { id: 'visa',       label: 'Visa',
      test: /^4/,                                     groups: [4,4,4,4], lengths: [16,19], cvc: [3], max: 19 },
    { id: 'mastercard', label: 'Mastercard',
      test: /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/,  groups: [4,4,4,4], lengths: [16],    cvc: [3], max: 16 },
    { id: 'amex',       label: 'American Express',
      test: /^3[47]/,                                 groups: [4,6,5],   lengths: [15],    cvc: [4], max: 15 },
    { id: 'diners',     label: 'Diners Club',
      test: /^3(0[0-5]|[68])/,                        groups: [4,6,4],   lengths: [14],    cvc: [3], max: 14 },
    { id: 'jcb',        label: 'JCB',
      test: /^35(2[89]|[3-8]\d)/,                     groups: [4,4,4,4], lengths: [16],    cvc: [3], max: 16 },
    { id: 'discover',   label: 'Discover',
      test: /^(6011|65|64[4-9])/,                     groups: [4,4,4,4], lengths: [16,19], cvc: [3], max: 19 }
  ];

  function detect(digits) {
    if (!digits) return UNKNOWN;
    for (var i = 0; i < BRANDS.length; i++) {
      if (BRANDS[i].test.test(digits)) return BRANDS[i];
    }
    return UNKNOWN;
  }

  /* Brand marks. Drawn inline so the component makes no requests.
     Font properties are written longhand — the `font` shorthand inside an
     SVG style attribute drops the style and weight in Chromium. */
  /* Single quotes only: this stack goes into a style="…" attribute, and a
     double-quoted family name closes the attribute early — which silently
     dropped every declaration after it, `fill` included. */
  var SANS = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";

  function type(size, weight, italic, extra) {
    return 'fill:' + (extra && /fill:/.test(extra) ? '' : 'currentColor') +
           ';font-family:' + SANS + ';font-size:' + size + 'px;font-weight:' + weight +
           ';font-style:' + (italic ? 'italic' : 'normal') + ';' + (extra || '');
  }

  var MARKS = {
    visa:
      '<svg viewBox="0 0 62 22"><text x="0" y="17" style="' +
      type(17, 800, true, 'letter-spacing:.01em;fill:currentColor') + '">VISA</text></svg>',
    mastercard:
      '<svg viewBox="0 0 44 22">' +
      '<circle cx="15" cy="11" r="9.4" fill="#e2574c"/>' +
      '<circle cx="27" cy="11" r="9.4" fill="#f0a136" fill-opacity=".92"/>' +
      '<path d="M21 4.2a9.4 9.4 0 0 0 0 13.6 9.4 9.4 0 0 0 0-13.6z" fill="#e07c3e"/></svg>',
    amex:
      '<svg viewBox="0 0 52 22">' +
      '<rect x="0" y="1" width="52" height="20" rx="3" fill="#1f6fd0"/>' +
      '<text x="26" y="15" text-anchor="middle" style="' +
      type(10, 800, false, 'letter-spacing:.09em;fill:#fff') + '">AMEX</text></svg>',
    discover:
      '<svg viewBox="0 0 80 22">' +
      '<text x="0" y="16" style="' +
      type(13, 700, false, 'letter-spacing:-.01em;fill:currentColor') + '">DISCOVER</text>' +
      '<circle cx="74" cy="12" r="5" fill="#f08a24"/></svg>',
    jcb:
      '<svg viewBox="0 0 48 22">' +
      '<rect x="0"  y="2" width="14" height="18" rx="3" fill="#1c5fbe"/>' +
      '<rect x="16" y="2" width="14" height="18" rx="3" fill="#c0392f"/>' +
      '<rect x="32" y="2" width="14" height="18" rx="3" fill="#1f9250"/></svg>',
    diners:
      '<svg viewBox="0 0 60 22">' +
      '<circle cx="11" cy="11" r="10" fill="#2b6bb5"/>' +
      '<circle cx="11" cy="11" r="5" fill="#fff"/>' +
      '<text x="25" y="15" style="' +
      type(10, 700, false, 'letter-spacing:.06em;fill:currentColor') + '">DINERS</text></svg>'
  };

  /* ── PAN grouping / rendering ─────────────────────────── */

  function groupsFor(brand, len) {
    var g = brand.groups.slice();
    var nominal = 0, i;
    for (i = 0; i < g.length; i++) nominal += g[i];
    if (len > nominal) g.push(len - nominal);
    return g;
  }

  function formatPan(digits, brand) {
    var g = groupsFor(brand, digits.length);
    var out = [], i = 0, k;
    for (k = 0; k < g.length && i < digits.length; k++) {
      out.push(digits.slice(i, i + g[k]));
      i += g[k];
    }
    return out.join(' ');
  }

  /* Empty positions render as small dots so the card never looks broken.
     Slots are stable elements rebuilt only when the grouping itself changes,
     so a keystroke animates the one digit that landed rather than all of them. */
  var panShape = '';
  var panWasValid = false;

  function renderPan(digits, brand) {
    var g = groupsFor(brand, digits.length);
    var shape = g.join('-');

    if (shape !== panShape) {
      panShape = shape;
      var html = '', k, j;
      for (k = 0; k < g.length; k++) {
        html += '<span class="pan__grp">';
        for (j = 0; j < g[k]; j++) html += '<span class="pan__ch pan__dot">&bull;</span>';
        html += '</span>';
      }
      panOut.innerHTML = html;
    }

    var cells = panOut.querySelectorAll('.pan__ch');
    for (var i = 0; i < cells.length; i++) {
      setCell(cells[i], digits.charAt(i), 'pan__dot');
    }
  }

  /* Fill or empty one character slot, animating only a fresh arrival. */
  function setCell(cell, ch, dotClass) {
    var wasEmpty = cell.classList.contains(dotClass);
    if (ch) {
      if (wasEmpty || cell.textContent !== ch) {
        cell.textContent = ch;
        cell.classList.remove(dotClass);
        if (wasEmpty && !reduced()) {
          cell.classList.remove('is-set');
          void cell.offsetWidth;                 // restart the animation
          cell.classList.add('is-set');
        }
      }
    } else if (!wasEmpty) {
      cell.textContent = '•';
      cell.classList.add(dotClass);
      cell.classList.remove('is-set');
    }
  }

  function luhn(d) {
    var sum = 0, alt = false, n, i;
    for (i = d.length - 1; i >= 0; i--) {
      n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return d.length > 0 && sum % 10 === 0;
  }

  /* ── caret-safe reformatting ──────────────────────────── */

  function digitsBefore(str, pos) {
    var n = 0, i;
    for (i = 0; i < pos && i < str.length; i++) if (isDigit(str.charAt(i))) n++;
    return n;
  }

  function caretAfterDigit(formatted, n) {
    if (n <= 0) return 0;
    var seen = 0, i;
    for (i = 0; i < formatted.length; i++) {
      if (isDigit(formatted.charAt(i))) {
        seen++;
        if (seen === n) return i + 1;
      }
    }
    return formatted.length;
  }

  function setCaret(el, pos) {
    try { el.setSelectionRange(pos, pos); } catch (err) { /* type may not support it */ }
  }

  /* ── component state (never holds the CVC) ────────────── */

  var panDigits = '';
  var expDigits = '';
  var brand = UNKNOWN;
  var phase = 'idle';          // idle | authorising | approved | declined
  var settleTimer = null;
  var collapseTimer = null;
  var resizeRaf = 0;

  function announce(msg) { live.textContent = msg; }

  /* ── brand application ────────────────────────────────── */

  function applyBrand(next, force) {
    if (!force && next.id === brand.id) return;
    brand = next;
    card.dataset.brand = next.id;

    var svg = MARKS[next.id] || '';
    [brandCard, brandBack, brandField].forEach(function (el) {
      el.innerHTML = svg;
      el.classList.toggle('is-on', !!svg);
    });

    numEl.setAttribute('maxlength', String(next.max + groupsFor(next, next.max).length - 1));
    cvcEl.setAttribute('maxlength', String(Math.max.apply(null, next.cvc)));
    cvcEl.setAttribute('placeholder', next.cvc[0] === 4 ? '••••' : '•••');
    renderCvc(cvcEl.value.replace(/\D+/g, ''));
  }

  /* ── field → card sync (instant, no transition) ───────── */

  function syncName() {
    var v = nameEl.value.trim();
    nameOut.textContent = v ? v.toUpperCase() : 'YOUR NAME';
  }

  function syncExpCard() {
    var mm = expDigits.slice(0, 2), yy = expDigits.slice(2, 4);
    while (mm.length < 2) mm += '•';
    while (yy.length < 2) yy += '•';
    expOut.textContent = mm + '/' + yy;
  }

  /* ── card number input ────────────────────────────────── */

  function onPanInput(e) {
    var raw = numEl.value;
    var caret = numEl.selectionStart == null ? raw.length : numEl.selectionStart;
    var idx = digitsBefore(raw, caret);
    var digits = raw.replace(/\D+/g, '');
    var deleting = !!e && e.inputType === 'deleteContentBackward';

    /* Backspacing onto a group separator should eat the digit before it,
       otherwise the space reappears and the key does nothing. */
    if (deleting && digits.length === panDigits.length && idx > 0) {
      digits = digits.slice(0, idx - 1) + digits.slice(idx);
      idx -= 1;
    }

    var next = detect(digits);
    digits = digits.slice(0, next.max);
    if (idx > digits.length) idx = digits.length;

    panDigits = digits;
    applyBrand(next);

    var formatted = formatPan(digits, next);
    numEl.value = formatted;
    setCaret(numEl, caretAfterDigit(formatted, idx));

    renderPan(digits, next);

    var nowValid = !validateNumber();
    if (nowValid && !panWasValid) sheenSweep();     /* "card recognised" */
    panWasValid = nowValid;

    if (fieldOf(numEl).classList.contains('has-error')) revalidate(numEl);
    if (fieldOf(cvcEl).classList.contains('has-error')) revalidate(cvcEl);
  }

  /* ── expiry input ─────────────────────────────────────── */

  function onExpInput(e) {
    var raw = expEl.value;
    var caret = expEl.selectionStart == null ? raw.length : expEl.selectionStart;
    var idx = digitsBefore(raw, caret);
    var digits = raw.replace(/\D+/g, '');
    var deleting = !!e && e.inputType === 'deleteContentBackward';

    if (deleting && digits.length === expDigits.length && idx > 0) {
      digits = digits.slice(0, idx - 1) + digits.slice(idx);
      idx -= 1;
    }

    /* "5" is unambiguously May — pad it so the month never sits half-typed. */
    if (!deleting && digits.length === 1 && digits > '1' && idx === 1) {
      digits = '0' + digits;
      idx = 2;
    }

    digits = digits.slice(0, 4);
    if (idx > digits.length) idx = digits.length;

    expDigits = digits;
    var formatted = digits.length >= 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
    expEl.value = formatted;

    var pos = caretAfterDigit(formatted, idx);
    if (!deleting && pos < formatted.length && formatted.charAt(pos) === '/') pos += 1;
    setCaret(expEl, pos);

    syncExpCard();
    if (fieldOf(expEl).classList.contains('has-error')) revalidate(expEl);
  }

  /* ── CVC input — mirrored to the card, held nowhere else ─ */

  var cvcShape = 0;

  function renderCvc(digits) {
    var n = brand.cvc[0];
    if (cvcShape !== n) {
      cvcShape = n;
      var html = '', k;
      for (k = 0; k < n; k++) html += '<span class="cvc__ch cvc__dot">&bull;</span>';
      cvcOut.innerHTML = html;
    }
    var cells = cvcOut.querySelectorAll('.cvc__ch');
    for (var i = 0; i < cells.length; i++) {
      setCell(cells[i], digits.charAt(i), 'cvc__dot');
    }
  }

  function onCvcInput() {
    var digits = cvcEl.value.replace(/\D+/g, '')
      .slice(0, Math.max.apply(null, brand.cvc));
    if (cvcEl.value !== digits) {
      var caret = cvcEl.selectionStart == null ? digits.length : cvcEl.selectionStart;
      cvcEl.value = digits;
      setCaret(cvcEl, Math.min(caret, digits.length));
    }
    renderCvc(digits);
    if (fieldOf(cvcEl).classList.contains('has-error')) revalidate(cvcEl);
  }

  /* Reading it is fine; keeping it is not. The slots fall back to dots. */
  function wipeCvc() {
    cvcEl.value = '';
    renderCvc('');
  }

  /* ── flip ─────────────────────────────────────────────── */

  /* ── card effects ──────────────────────────────────────
     One gesture owns .card__tilt at a time; the helper clears the
     others so two keyframe sets can never fight over the element. */

  var TILT_FX = ['is-entering', 'is-dipping', 'is-arriving',
                 'is-shaking', 'is-settling', 'is-floating'];
  var tiltTimer = null;

  function tiltFx(name, ms, then) {
    if (tiltTimer) { window.clearTimeout(tiltTimer); tiltTimer = null; }
    TILT_FX.forEach(function (c) { tilt.classList.remove(c); });
    if (!name || reduced()) { if (then) then(); return; }
    void tilt.offsetWidth;                      // restart cleanly
    tilt.classList.add(name);
    if (ms) {
      tiltTimer = window.setTimeout(function () {
        tiltTimer = null;
        tilt.classList.remove(name);
        if (then) then();
      }, ms);
    }
  }

  function sheenSweep() {
    if (reduced()) return;
    sheen.classList.remove('is-sweeping', 'is-looping');
    void sheen.offsetWidth;
    sheen.classList.add('is-sweeping');
  }

  function sheenLoop(on) {
    sheen.classList.remove('is-sweeping', 'is-looping');
    if (on && !reduced()) {
      void sheen.offsetWidth;
      sheen.classList.add('is-looping');
    }
  }

  function glowFx(name) {
    glow.classList.remove('is-breathing', 'is-blooming');
    if (name && !reduced()) {
      void glow.offsetWidth;
      glow.classList.add(name);
    }
  }

  function flip(on) {
    var was = inner.classList.contains('is-flipped');
    inner.classList.toggle('is-flipped', !!on);
    if (was !== !!on) tiltFx('is-dipping', 600);   // it pulls back as it swings
  }

  cvcEl.addEventListener('focus', function () { if (phase === 'idle') flip(true); });
  cvcEl.addEventListener('blur',  function () { flip(false); });

  /* ── pointer tilt, with parallax and a tracking specular ── */

  slot.addEventListener('pointermove', function (e) {
    if (phase !== 'idle' || reduced() || e.pointerType === 'touch') return;
    var r = slot.getBoundingClientRect();
    var u = (e.clientX - r.left) / r.width;
    var v = (e.clientY - r.top) / r.height;
    var px = u - 0.5, py = v - 0.5;

    tilt.style.transform = 'rotateY(' + (px * 14).toFixed(2) + 'deg) rotateX(' +
                           (-py * 11).toFixed(2) + 'deg)';
    card.style.setProperty('--px', (px * 2).toFixed(3));
    card.style.setProperty('--py', (py * 2).toFixed(3));
    card.style.setProperty('--mx', (u * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (v * 100).toFixed(1) + '%');
  });

  slot.addEventListener('pointerleave', function () {
    tilt.style.transform = '';
    card.style.setProperty('--px', '0');
    card.style.setProperty('--py', '0');
  });

  /* ── FLIP: slot → centre of the panel ─────────────────────
     Measured off the slot, which is never transformed. A tilted or
     flipped card reports its axis-aligned bounding box, so measuring
     the card itself would give the wrong number. ── */

  function centreTransform() {
    var s = slot.getBoundingClientRect();
    var target = stage.getBoundingClientRect();

    var grow = clamp((target.width * 0.44) / s.width, 1, 1.34);

    /* Size the landing zone to the grown card first, then measure it —
       reading the zone before this would give the previous layout. */
    stage.style.setProperty('--zone-h', (s.height * grow + 56).toFixed(1) + 'px');
    var z = zone.getBoundingClientRect();

    var dx = (z.left + z.width / 2) - (s.left + s.width / 2);
    var dy = (z.top + z.height / 2) - (s.top + s.height / 2);

    return 'translate(' + dx.toFixed(2) + 'px, ' + dy.toFixed(2) + 'px) scale(' +
           grow.toFixed(4) + ')';
  }

  /* The form fades over 240ms and only then leaves the layout, so the panel
     resizes behind an already-invisible column. That second beat moves the
     landing zone, so the target is recomputed then — the 620ms transition is
     still running and simply retargets, with no snap. */
  function collapseLayout() {
    collapseTimer = null;
    panel.classList.add('is-collapsed');
    card.style.transform = centreTransform();
  }

  function moveCardToCentre() {
    var before = slot.getBoundingClientRect();
    panel.classList.add('is-busy');
    var after = slot.getBoundingClientRect();

    if (reduced()) {
      panel.classList.add('is-collapsed');
      card.style.transform = centreTransform();
      return;
    }

    collapseTimer = window.setTimeout(collapseLayout, 250);

    /* Invert: hold the card where it was, then play to the target. */
    card.style.transition = 'none';
    card.style.transform = 'translate(' + (before.left - after.left).toFixed(2) + 'px, ' +
                           (before.top - after.top).toFixed(2) + 'px)';
    void card.offsetWidth;
    card.style.transition = '';

    requestAnimationFrame(function () {
      card.style.transform = centreTransform();
    });
  }

  function recentre() {
    if (!panel.classList.contains('is-busy')) return;
    card.style.transition = 'none';
    card.style.transform = centreTransform();
    void card.offsetWidth;
    card.style.transition = '';
  }

  window.addEventListener('resize', function () {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; recentre(); });
  });

  /* ── validation ───────────────────────────────────────── */

  function fieldOf(el) { return el.closest('.field'); }

  function validateName() {
    return nameEl.value.trim().length >= 2
      ? '' : 'Enter the name printed on the card.';
  }

  function validateNumber() {
    if (!panDigits) return 'Enter your card number.';
    var b = detect(panDigits);
    if (b.lengths.indexOf(panDigits.length) === -1) {
      var min = Math.min.apply(null, b.lengths);
      return panDigits.length < min
        ? 'That number is too short for a ' + b.label + ' card.'
        : 'That number is too long for a ' + b.label + ' card.';
    }
    if (!luhn(panDigits)) return 'That card number does not check out.';
    return '';
  }

  function validateExp() {
    if (expDigits.length !== 4) return 'Enter the expiry as MM / YY.';
    var m = parseInt(expDigits.slice(0, 2), 10);
    var y = 2000 + parseInt(expDigits.slice(2, 4), 10);
    if (m < 1 || m > 12) return 'Month must be between 01 and 12.';
    var endOfMonth = new Date(y, m, 1);
    if (endOfMonth <= new Date()) return 'That card has expired.';
    return '';
  }

  function validateCvc() {
    var len = cvcEl.value.replace(/\D+/g, '').length;   // length only, never the value
    var b = detect(panDigits);
    if (!len) return 'Enter the security code.';
    if (b.cvc.indexOf(len) === -1) {
      return 'The code is ' + b.cvc[0] + ' digits on a ' + b.label + ' card.';
    }
    return '';
  }

  var VALIDATORS = [
    { el: nameEl, err: $('#errName'),   run: validateName },
    { el: numEl,  err: $('#errNumber'), run: validateNumber },
    { el: expEl,  err: $('#errExp'),    run: validateExp },
    { el: cvcEl,  err: $('#errCvc'),    run: validateCvc }
  ];

  function entryFor(el) {
    for (var i = 0; i < VALIDATORS.length; i++) if (VALIDATORS[i].el === el) return VALIDATORS[i];
    return null;
  }

  function show(entry, msg) {
    entry.err.textContent = msg;
    fieldOf(entry.el).classList.toggle('has-error', !!msg);
    entry.el.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function revalidate(el) {
    var entry = entryFor(el);
    if (entry) show(entry, entry.run());
  }

  function clearErrors() {
    VALIDATORS.forEach(function (entry) { show(entry, ''); });
  }

  /* Errors surface on blur, not on every keystroke. Once the form has been
     sent the fields are being torn down, so blur is not a user judgement. */
  VALIDATORS.forEach(function (entry) {
    entry.el.addEventListener('blur', function () {
      if (phase !== 'idle') return;
      show(entry, entry.run());
    });
  });

  /* ── halo ─────────────────────────────────────────────── */

  function halo(kind) {
    glow.classList.remove('is-pending', 'is-ok', 'is-bad');
    if (kind) glow.classList.add('is-' + kind);
  }

  function indicator(mode) { ind.dataset.mode = mode; }

  /* ── phases ───────────────────────────────────────────── */

  function maskedLine() {
    var label = brand.id === 'unknown' ? 'Card' : brand.label;
    return label + ' •••• ' + panDigits.slice(-4) +
           ' · ' + money(TOTAL_CENTS);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (phase !== 'idle') return;

    var firstBad = null;
    VALIDATORS.forEach(function (entry) {
      var msg = entry.run();
      show(entry, msg);
      if (msg && !firstBad) firstBad = entry;
    });

    if (firstBad) {
      firstBad.el.focus();
      announce('Check the form: ' + firstBad.err.textContent);
      return;
    }

    var approves = panDigits === APPROVE_PAN;
    var summary = maskedLine();

    phase = 'authorising';
    panel.dataset.phase = phase;

    wipeCvc();                 // gone from the DOM before anything else happens
    cvcEl.blur();
    flip(false);

    tilt.style.transform = '';
    card.style.setProperty('--px', '0');
    card.style.setProperty('--py', '0');

    /* Unwind out of a 3D turn on the way in, then settle into a slow drift. */
    tiltFx('is-arriving', 620, function () { tiltFx('is-floating'); });
    sheenLoop(true);
    glowFx('is-breathing');

    halo('pending');
    indicator('spin');
    stageHead.textContent = 'Authorising with your bank';
    stageSub.textContent = summary;
    stageReason.textContent = '';
    againBtn.hidden = true;
    retryBtn.hidden = true;

    moveCardToCentre();
    announce('Authorising ' + summary);

    settleTimer = window.setTimeout(function () {
      settleTimer = null;
      if (approves) approve(summary); else decline(summary);
    }, SETTLE_MS);
  });

  function approve(summary) {
    phase = 'approved';
    panel.dataset.phase = phase;

    halo('ok');
    glowFx('is-blooming');
    tiltFx('is-settling', 560);
    sheenSweep();
    indicator('ok');
    stageHead.textContent = 'Paid ' + money(TOTAL_CENTS);
    stageSub.textContent = 'Receipt on its way to you';
    stageReason.textContent = summary;

    retryBtn.hidden = true;
    againBtn.hidden = false;
    againBtn.focus();

    announce('Payment approved. Paid ' + money(TOTAL_CENTS) +
             '. Receipt on its way to you.');
  }

  function decline(summary) {
    phase = 'declined';
    panel.dataset.phase = phase;

    halo('bad');
    glowFx(null);
    sheenLoop(false);
    tiltFx('is-shaking', 640);
    indicator('bad');
    stageHead.textContent = 'Card declined';
    stageSub.textContent = summary;
    stageReason.textContent =
      'Your bank turned this one down — insufficient funds. ' +
      'Nothing has been charged.';

    againBtn.hidden = true;
    retryBtn.hidden = false;
    retryBtn.focus();

    announce('Card declined. Your bank turned this one down, insufficient funds. ' +
             'Nothing has been charged.');
  }

  /* ── returning to idle ────────────────────────────────── */

  function toIdle(opts) {
    opts = opts || {};

    if (settleTimer) { window.clearTimeout(settleTimer); settleTimer = null; }
    if (collapseTimer) { window.clearTimeout(collapseTimer); collapseTimer = null; }

    phase = 'idle';
    panel.dataset.phase = phase;

    panel.classList.remove('is-busy', 'is-collapsed');
    tiltFx(null);
    sheenLoop(false);
    glowFx(null);
    tilt.style.transform = '';
    card.style.setProperty('--px', '0');
    card.style.setProperty('--py', '0');
    card.style.transform = '';          // travels back to the slot
    flip(false);
    halo(null);                          // red/green fades back to blue, no residue
    indicator('spin');

    stageHead.textContent = 'Authorising with your bank';
    stageSub.textContent = '';
    stageReason.textContent = '';
    againBtn.hidden = true;
    retryBtn.hidden = true;

    wipeCvc();                           // a re-entered code is a fresh one
    clearErrors();

    if (opts.clearAll) {
      nameEl.value = '';
      numEl.value = '';
      expEl.value = '';
      panDigits = '';
      expDigits = '';
      applyBrand(UNKNOWN, true);
      syncName();
      syncExpCard();
      renderPan('', UNKNOWN);
    }

    if (opts.focus === 'number') {
      numEl.focus();
      numEl.select();
      announce('Back to the form. Enter another card number and security code.');
    } else if (opts.focus === 'name') {
      nameEl.focus();
      announce('Reset. The form is ready for a new payment.');
    }
  }

  againBtn.addEventListener('click', function () { toIdle({ clearAll: true, focus: 'name' }); });
  retryBtn.addEventListener('click', function () { toIdle({ focus: 'number' }); });

  /* ── theme ─────────────────────────────────────────────
     Follows the OS until the user overrides it, then holds that
     choice for the session. Nothing is persisted — no storage. */

  var themeBtn = $('#themeBtn');
  var themeLabel = $('#themeLabel');
  var darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  var themeChoice = null;                 // null = follow the system

  function isDark() {
    return themeChoice === null ? darkMQ.matches : themeChoice === 'dark';
  }

  function paintTheme() {
    var dark = isDark();
    if (themeChoice === null) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeChoice);
    }
    themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    themeBtn.setAttribute('aria-label',
      'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
    themeLabel.textContent = dark ? 'Dark' : 'Light';
  }

  themeBtn.addEventListener('click', function () {
    themeChoice = isDark() ? 'light' : 'dark';
    paintTheme();
    announce(themeLabel.textContent + ' theme');
  });

  if (darkMQ.addEventListener) {
    darkMQ.addEventListener('change', function () { if (themeChoice === null) paintTheme(); });
  }

  paintTheme();

  /* ── test-card chips ──────────────────────────────────── */

  function futureExpiry() {
    var yy = (new Date().getFullYear() + 3) % 100;
    return '12' + (yy < 10 ? '0' + yy : String(yy));
  }

  Array.prototype.forEach.call(document.querySelectorAll('.chip-btn'), function (chipBtn) {
    chipBtn.addEventListener('click', function () {
      if (phase !== 'idle') toIdle({ clearAll: true });

      nameEl.value = 'A. Mercer';
      syncName();

      numEl.value = chipBtn.dataset.pan;
      onPanInput(null);

      expEl.value = futureExpiry();
      onExpInput(null);

      /* Built here rather than stored on the button, so no security code —
         not even this throwaway demo one — ever sits in the markup. */
      cvcEl.value = String(100 + 23);
      onCvcInput();

      clearErrors();
      payBtn.focus();
      announce('Form filled with the test card ending ' +
               chipBtn.dataset.pan.slice(-4) + '.');
    });
  });

  /* ── wiring ───────────────────────────────────────────── */

  nameEl.addEventListener('input', function () {
    syncName();
    if (fieldOf(nameEl).classList.contains('has-error')) revalidate(nameEl);
  });
  numEl.addEventListener('input', onPanInput);
  expEl.addEventListener('input', onExpInput);
  cvcEl.addEventListener('input', onCvcInput);

  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener('change', recentre);
  } else if (reduceMQ.addListener) {
    reduceMQ.addListener(recentre);
  }

  /* ── first paint ──────────────────────────────────────── */

  $('#payTotal').textContent = money(TOTAL_CENTS);
  $('#totalOut').textContent = money(TOTAL_CENTS);
  applyBrand(UNKNOWN, true);
  renderPan('', UNKNOWN);
  renderCvc('');
  syncName();
  syncExpCard();
  panel.dataset.phase = 'idle';
  tiltFx('is-entering', 800);
})();
