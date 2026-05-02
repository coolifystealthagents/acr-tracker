/**
 * ACR Tracker — Vanilla JS (WordPress Edition)
 * @version 0.3.0-wp
 *
 * Drop-in analytics tracker for WordPress sites.
 * No React, no Next.js, no npm required.
 *
 * Usage:
 *   <script>
 *     window.ACR_TRACKER_CONFIG = {
 *       siteId: 'stealth-agents',
 *       endpoint: '/wp-json/acr-tracker/v1/ingest',
 *       debug: false
 *     };
 *   </script>
 *   <script src="/wp-content/mu-plugins/acr-tracker.wp.js" defer></script>
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────
  var cfg = window.ACR_TRACKER_CONFIG || {};
  var SITE_ID = cfg.siteId || '';
  var ENDPOINT = cfg.endpoint || '/wp-json/acr-tracker/v1/ingest';
  var BATCH_MS = cfg.batchInterval || 5000;
  var DEBUG = !!cfg.debug;
  var FUNNEL = cfg.funnelSteps || [
    { path: '/contact-us', step: 1, label: 'Form Page', event: 'funnel_form_page' },
    { path: '/thank-you', step: 2, label: 'Form Submitted', event: 'funnel_form_submitted' },
    { path: '/thanks-whats-next', step: 3, label: 'Booking Confirmed', event: 'funnel_booking_confirmed' }
  ];

  if (!SITE_ID) {
    console.warn('[acr-tracker] No siteId configured. Set window.ACR_TRACKER_CONFIG.siteId');
    return;
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function log() {
    if (DEBUG) console.log.apply(console, ['[acr-tracker]'].concat(Array.prototype.slice.call(arguments)));
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function getAnonymousId() {
    var key = '_acr_aid';
    try {
      var id = localStorage.getItem(key);
      if (id) return id;
      id = generateId();
      localStorage.setItem(key, id);
      return id;
    } catch (e) {
      return generateId();
    }
  }

  var SESSION_TIMEOUT = 30 * 60 * 1000;
  function getSessionId() {
    var sidKey = '_acr_sid', tsKey = '_acr_sid_ts';
    try {
      var now = Date.now();
      var sid = sessionStorage.getItem(sidKey);
      var ts = sessionStorage.getItem(tsKey);
      if (sid && ts && now - parseInt(ts, 10) < SESSION_TIMEOUT) {
        sessionStorage.setItem(tsKey, '' + now);
        return sid;
      }
      var id = generateId();
      sessionStorage.setItem(sidKey, id);
      sessionStorage.setItem(tsKey, '' + now);
      return id;
    } catch (e) {
      return generateId();
    }
  }

  function getUtmParams() {
    try {
      var p = new URLSearchParams(location.search);
      return {
        utm_source: p.get('utm_source') || '',
        utm_medium: p.get('utm_medium') || '',
        utm_campaign: p.get('utm_campaign') || '',
        utm_term: p.get('utm_term') || '',
        utm_content: p.get('utm_content') || ''
      };
    } catch (e) {
      return { utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '' };
    }
  }

  function getDeviceContext() {
    try {
      var nav = navigator;
      var conn = nav.connection || {};
      return {
        language: nav.language || '',
        languages: Array.from(nav.languages || []),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        pixel_ratio: window.devicePixelRatio || 1,
        color_depth: screen.colorDepth,
        touch_support: nav.maxTouchPoints > 0,
        connection_type: conn.effectiveType || '',
        connection_downlink: conn.downlink != null ? conn.downlink : null,
        connection_rtt: conn.rtt != null ? conn.rtt : null,
        pdf_viewer: nav.pdfViewerEnabled != null ? nav.pdfViewerEnabled : null,
        hardware_concurrency: nav.hardwareConcurrency || null,
        cookie_enabled: nav.cookieEnabled,
        do_not_track: nav.doNotTrack === '1',
        online: nav.onLine
      };
    } catch (e) {
      return {};
    }
  }

  // ── Bot Detection ───────────────────────────────────────────────────
  var isBot = false;
  if (navigator.webdriver) isBot = true;
  var pageLoadTime = typeof performance !== 'undefined' ? performance.now() : null;
  if (pageLoadTime !== null && pageLoadTime < 50) isBot = true;
  if (isBot) { log('Bot detected, skipping tracking'); return; }

  // ── Landing Page / Referrer ─────────────────────────────────────────
  try {
    if (!sessionStorage.getItem('_acr_lp')) {
      sessionStorage.setItem('_acr_lp', location.href);
      sessionStorage.setItem('_acr_lr', document.referrer || '(direct)');
    }
  } catch (e) {}

  function getLandingPage() { try { return sessionStorage.getItem('_acr_lp') || ''; } catch (e) { return ''; } }
  function getLandingReferrer() { try { return sessionStorage.getItem('_acr_lr') || ''; } catch (e) { return ''; } }

  // ── Engagement Time ─────────────────────────────────────────────────
  var engagementStart = Date.now();
  var engagementMs = 0;
  var isVisible = true;
  var deviceCtx = getDeviceContext();

  function getEngagementTime() {
    return isVisible ? engagementMs + (Date.now() - engagementStart) : engagementMs;
  }

  // ── Event Queue & Flush ─────────────────────────────────────────────
  var queue = [];

  function buildEvent(eventType, extra) {
    var utm = getUtmParams();
    var meta = {
      engagement_time_ms: getEngagementTime(),
      landing_page: getLandingPage(),
      landing_referrer: getLandingReferrer()
    };
    // Merge device context
    for (var k in deviceCtx) meta[k] = deviceCtx[k];

    // Merge any extra metadata
    if (extra && extra.event_metadata) {
      try {
        var parsed = JSON.parse(extra.event_metadata);
        for (var k2 in parsed) meta[k2] = parsed[k2];
      } catch (e) { meta.raw_metadata = extra.event_metadata; }
    }

    var ev = {
      event_type: eventType,
      timestamp: new Date().toISOString(),
      session_id: getSessionId(),
      anonymous_id: getAnonymousId(),
      page_url: location.href,
      page_path: location.pathname,
      page_title: document.title,
      referrer: document.referrer,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      utm_term: utm.utm_term,
      utm_content: utm.utm_content,
      screen_width: screen.width,
      screen_height: screen.height,
      scroll_depth: 0,
      time_on_page: pageLoadTime ? Math.round(performance.now() - pageLoadTime) : 0,
      event_value: '',
      event_metadata: JSON.stringify(meta)
    };

    if (extra) {
      for (var ek in extra) {
        if (ek !== 'event_metadata') ev[ek] = extra[ek];
      }
      ev.event_metadata = JSON.stringify(meta);
    }

    return ev;
  }

  function flush() {
    if (!queue.length) return;
    var payload = { site_id: SITE_ID, events: queue.slice() };
    queue = [];
    var body = JSON.stringify(payload);
    log('Flushing', payload.events.length, 'events');
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function (err) { log('Flush error:', err); });
    } catch (e) { log('Flush exception:', e); }
  }

  function flushBeacon() {
    if (!queue.length) return;
    var payload = { site_id: SITE_ID, events: queue.slice() };
    var backup = queue.slice();
    queue = [];
    var body = JSON.stringify(payload);
    log('Beacon flush', payload.events.length, 'events');
    var sent = false;
    if (navigator.sendBeacon) {
      try { sent = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' })); } catch (e) { sent = false; }
    }
    if (!sent) {
      try { fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () { queue = backup.concat(queue); }); } catch (e) {}
    }
  }

  function enqueue(ev) { queue.push(ev); log('Enqueued:', ev.event_type); }

  // ── Public API ──────────────────────────────────────────────────────
  function track(eventType, metadata) {
    if (isBot) return;
    enqueue(buildEvent(eventType, { event_metadata: metadata ? JSON.stringify(metadata) : '{}' }));
  }

  function trackPageView() {
    if (isBot) return;
    enqueue(buildEvent('pageview'));
  }

  function trackScrollDepth(depth) {
    if (isBot) return;
    enqueue(buildEvent('scroll_depth', { scroll_depth: depth, event_value: depth + '%' }));
  }

  function trackCWV(metric) {
    if (isBot) return;
    enqueue(buildEvent('cwv', {
      event_value: '' + metric.value,
      event_metadata: JSON.stringify({ metric_name: metric.name, metric_value: metric.value })
    }));
  }

  function trackLead(data) {
    if (isBot) return;
    var meta = {
      lead_name: data.name || '',
      lead_email: data.email || '',
      lead_phone: data.phone || '',
      lead_message: data.message || '',
      lead_source: data.source || '',
      lead_form_id: data.formId || ''
    };
    enqueue(buildEvent('lead_submit', { event_value: data.source || '', event_metadata: JSON.stringify(meta) }));
    flush();
    log('Lead tracked and flushed immediately');
  }

  // Normalize path: strip trailing slash for consistent matching (WordPress uses trailing slashes)
  function normPath(p) { var lp = p.toLowerCase(); return lp.length > 1 && lp.charAt(lp.length - 1) === '/' ? lp.slice(0, -1) : lp; }

  function checkFunnelStep() {
    if (isBot) return;
    var path = normPath(location.pathname);
    for (var i = 0; i < FUNNEL.length; i++) {
      var s = FUNNEL[i];
      var sp = normPath(s.path);
      var matches = s.path.endsWith('*') ? path.indexOf(s.path.slice(0, -1)) === 0 : path === sp;
      if (matches) {
        enqueue(buildEvent(s.event, {
          event_value: 'step_' + s.step,
          event_metadata: JSON.stringify({ funnel_step: s.step, funnel_label: s.label, funnel_path: s.path })
        }));
        log('Funnel step ' + s.step + ': ' + s.label);
        if (s.step >= 3) flush();
        break;
      }
    }
  }

  // ── Auto-tracking Setup ─────────────────────────────────────────────

  // Batch timer
  var flushTimer = setInterval(flush, BATCH_MS);

  // Visibility change (engagement time + flush)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (isVisible) { engagementMs += Date.now() - engagementStart; isVisible = false; }
      flushBeacon();
    } else {
      engagementStart = Date.now();
      isVisible = true;
    }
  });

  window.addEventListener('beforeunload', flushBeacon);

  // 1. Page view + funnel check
  trackPageView();
  checkFunnelStep();

  // 2. Scroll depth tracking
  var scrollThresholds = [25, 50, 75, 100];
  var reachedThresholds = {};
  var scrollThrottle = false;

  window.addEventListener('scroll', function () {
    if (scrollThrottle) return;
    scrollThrottle = true;
    requestAnimationFrame(function () {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      var winHeight = window.innerHeight;
      var scrollable = docHeight - winHeight;
      var pct = scrollable > 0 ? Math.round((scrollTop / scrollable) * 100) : 100;
      for (var i = 0; i < scrollThresholds.length; i++) {
        var t = scrollThresholds[i];
        if (pct >= t && !reachedThresholds[t]) {
          reachedThresholds[t] = true;
          trackScrollDepth(t);
        }
      }
      scrollThrottle = false;
    });
  }, { passive: true });

  // 3. Form view detection
  var trackedForms = {};

  function scanForms() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var fp = (form.id || '') + '|' + (form.getAttribute('name') || '') + '|' + (form.action || '') + '|' + i;
      if (trackedForms[fp]) continue;
      trackedForms[fp] = true;
      var rect = form.getBoundingClientRect();
      track('form_view', {
        form_id: form.id || '',
        form_name: form.getAttribute('name') || '',
        form_action: form.action || '',
        form_classes: form.className || '',
        form_index: i,
        field_count: form.elements.length,
        form_visible: rect.width > 0 && rect.height > 0,
        form_position_y: Math.round(rect.top + window.scrollY),
        forms_on_page: forms.length
      });
    }
  }

  setTimeout(scanForms, 500);

  // Watch for dynamically inserted forms
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (mutations) {
      var hasNew = false;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.tagName === 'FORM' || (node.querySelector && node.querySelector('form'))) {
            hasNew = true;
          }
        }
      }
      if (hasNew) scanForms();
    }).observe(document.body, { childList: true, subtree: true });
  }

  // 4. CTA click tracking
  var CTA_PATTERNS = /\b(get.started|book|schedule|sign.up|register|subscribe|contact|free.trial|request|demo|apply|join|start|try|learn.more|find.out|call|hire|pricing)\b/i;

  function isCTA(el) {
    if (el.tagName === 'BUTTON' && !el.closest('form')) return true;
    if (/\b(cta|btn|button|hero|action)\b/i.test(el.className || '')) return true;
    var text = (el.textContent || '').trim();
    if (text.length > 0 && text.length < 80 && CTA_PATTERNS.test(text)) return true;
    if (el.getAttribute('role') === 'button') return true;
    return false;
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('a, button, [role="button"]') : null;
    if (!el || !isCTA(el)) return;
    var text = (el.textContent || '').slice(0, 200).trim();
    var href = el.href || '';
    track('cta_click', {
      cta_text: text,
      cta_tag: el.tagName.toLowerCase(),
      cta_id: el.id || '',
      cta_classes: (el.className || '').slice(0, 200),
      cta_href: href,
      cta_position_y: Math.round(el.getBoundingClientRect().top + window.scrollY)
    });
    // Store for form attribution
    try {
      sessionStorage.setItem('_acr_last_cta', JSON.stringify({ text: text, href: href, id: el.id || '', timestamp: Date.now() }));
    } catch (e2) {}
  }, true);

  // 5. Outbound / download / mailto / tel clicks
  document.addEventListener('click', function (e) {
    var anchor = e.target.closest ? e.target.closest('a') : null;
    if (!anchor || !anchor.href) return;
    try {
      var url = new URL(anchor.href, location.origin);
      var isOut = url.hostname !== location.hostname;
      var isDl = /\.(pdf|zip|doc|docx|xls|xlsx|csv|ppt|pptx)$/i.test(url.pathname);
      var isMail = anchor.href.indexOf('mailto:') === 0;
      var isTel = anchor.href.indexOf('tel:') === 0;
      if (isOut || isDl || isMail || isTel) {
        var type = isOut ? 'outbound_click' : isDl ? 'download_click' : isMail ? 'mailto_click' : 'tel_click';
        track(type, {
          link_url: anchor.href,
          link_text: (anchor.textContent || '').slice(0, 200).trim(),
          link_domain: isOut ? url.hostname : '',
          link_classes: anchor.className || '',
          link_id: anchor.id || ''
        });
      }
    } catch (e2) {}
  }, true);

  // 6. Form submission tracking (with CTA attribution)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var lastCta = null;
    try {
      var raw = sessionStorage.getItem('_acr_last_cta');
      if (raw) {
        lastCta = JSON.parse(raw);
        if (Date.now() - lastCta.timestamp > 30 * 60 * 1000) lastCta = null;
      }
    } catch (e2) {}
    var meta = {
      form_id: form.id || '',
      form_action: form.action || '',
      form_method: form.method || '',
      form_name: form.getAttribute('name') || '',
      form_classes: form.className || '',
      field_count: form.elements.length
    };
    if (lastCta) {
      meta.attributed_cta_text = lastCta.text;
      meta.attributed_cta_href = lastCta.href;
      meta.attributed_cta_id = lastCta.id;
    }
    track('form_submit', meta);
    flush(); // Forms are conversion-critical — flush immediately
  }, true);

  // 6b. WPForms AJAX submission detection
  // WPForms uses AJAX and prevents native form submit. Detect via:
  // - jQuery event 'wpformsAjaxSubmitSuccess' (if jQuery available)
  // - MutationObserver watching for .wpforms-confirmation-container (fallback)
  (function () {
    var wpformsTracked = {};

    function trackWpformSubmit(formEl) {
      if (!formEl) return;
      var formId = formEl.id || formEl.getAttribute('data-formid') || '';
      // Deduplicate within same session
      var key = formId + '|' + getSessionId();
      if (wpformsTracked[key]) return;
      wpformsTracked[key] = true;

      var lastCta = null;
      try {
        var raw = sessionStorage.getItem('_acr_last_cta');
        if (raw) {
          lastCta = JSON.parse(raw);
          if (Date.now() - lastCta.timestamp > 30 * 60 * 1000) lastCta = null;
        }
      } catch (e) {}

      // Try to extract form field values (name, email, phone, message)
      var leadData = {};
      try {
        var inputs = formEl.querySelectorAll('input, textarea, select');
        for (var i = 0; i < inputs.length; i++) {
          var input = inputs[i];
          var name = (input.getAttribute('name') || '').toLowerCase();
          var val = input.value || '';
          if (!val) continue;
          if (name.indexOf('name') > -1 || name.indexOf('first') > -1) leadData.lead_name = (leadData.lead_name || '') + ' ' + val;
          else if (name.indexOf('email') > -1) leadData.lead_email = val;
          else if (name.indexOf('phone') > -1 || name.indexOf('tel') > -1) leadData.lead_phone = val;
          else if (name.indexOf('message') > -1 || name.indexOf('comment') > -1 || input.tagName === 'TEXTAREA') leadData.lead_message = val;
        }
        if (leadData.lead_name) leadData.lead_name = leadData.lead_name.trim();
      } catch (e) {}

      var meta = {
        form_id: formId,
        form_plugin: 'wpforms',
        form_name: formEl.getAttribute('data-name') || formEl.getAttribute('name') || '',
        form_classes: formEl.className || '',
        field_count: formEl.elements ? formEl.elements.length : 0
      };
      // Merge lead data
      for (var k in leadData) meta[k] = leadData[k];
      if (lastCta) {
        meta.attributed_cta_text = lastCta.text;
        meta.attributed_cta_href = lastCta.href;
        meta.attributed_cta_id = lastCta.id;
      }

      track('form_submit', meta);

      // Also fire as lead_submit if we captured contact info
      if (leadData.lead_email || leadData.lead_phone || leadData.lead_name) {
        trackLead({
          name: leadData.lead_name || '',
          email: leadData.lead_email || '',
          phone: leadData.lead_phone || '',
          message: leadData.lead_message || '',
          source: 'wpforms',
          formId: formId
        });
      } else {
        flush(); // Still flush immediately for form submissions
      }

      log('WPForms submission tracked:', formId);
    }

    // Method 1: jQuery event (preferred — WPForms fires this)
    if (typeof jQuery !== 'undefined') {
      jQuery(document).on('wpformsAjaxSubmitSuccess', function (e, response) {
        // Find the form that was submitted
        var formEl = null;
        try {
          if (response && response.data && response.data.form_id) {
            formEl = document.getElementById('wpforms-form-' + response.data.form_id)
                  || document.querySelector('[data-formid="' + response.data.form_id + '"]');
          }
        } catch (ex) {}
        if (!formEl) formEl = document.querySelector('.wpforms-form');
        trackWpformSubmit(formEl);
      });
    }

    // Method 2: MutationObserver for confirmation container (catches non-jQuery too)
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            var isConfirm = (node.classList && node.classList.contains('wpforms-confirmation-container'))
                         || (node.querySelector && node.querySelector('.wpforms-confirmation-container'));
            if (isConfirm) {
              // Find the parent form or sibling form
              var formEl = node.closest ? node.closest('.wpforms-container') : null;
              if (formEl) formEl = formEl.querySelector('.wpforms-form');
              if (!formEl) formEl = document.querySelector('.wpforms-form');
              trackWpformSubmit(formEl);
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  })();

  // 7. JS error tracking
  window.addEventListener('error', function (e) {
    track('js_error', {
      error_message: e.message || '',
      error_source: e.filename || '',
      error_line: e.lineno || 0,
      error_col: e.colno || 0
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    track('unhandled_rejection', {
      error_message: String((e.reason && e.reason.message) || e.reason || '')
    });
  });

  // 8. Core Web Vitals (lightweight inline, no external dependency)
  // Uses PerformanceObserver API directly — same data as web-vitals library
  if (typeof PerformanceObserver !== 'undefined') {
    // LCP
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length) trackCWV({ name: 'LCP', value: entries[entries.length - 1].startTime });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}

    // FCP
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].name === 'first-contentful-paint') {
            trackCWV({ name: 'FCP', value: entries[i].startTime });
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch (e) {}

    // CLS
    try {
      var clsValue = 0;
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].hadRecentInput) clsValue += entries[i].value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      // Report CLS on page hide
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && clsValue > 0) {
          trackCWV({ name: 'CLS', value: clsValue });
        }
      });
    } catch (e) {}

    // INP (Interaction to Next Paint)
    try {
      var inpValue = 0;
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].duration > inpValue) inpValue = entries[i].duration;
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && inpValue > 0) {
          trackCWV({ name: 'INP', value: inpValue });
        }
      });
    } catch (e) {}

    // TTFB
    try {
      var navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length) {
        trackCWV({ name: 'TTFB', value: navEntries[0].responseStart });
      }
    } catch (e) {}
  }

  // ── Expose Public API ───────────────────────────────────────────────
  window.acrTracker = {
    track: track,
    trackPageView: trackPageView,
    trackScrollDepth: trackScrollDepth,
    trackCWV: trackCWV,
    trackLead: trackLead,
    checkFunnelStep: checkFunnelStep,
    flush: flush,
    destroy: function () {
      clearInterval(flushTimer);
      flushBeacon();
    }
  };

  log('Initialized for site:', SITE_ID, '→', ENDPOINT);
})();
