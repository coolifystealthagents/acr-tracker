// src/AcrTracker.tsx
import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

// src/utils.ts
function generateId() {
  return crypto.randomUUID();
}
function getAnonymousId() {
  const key = "_acr_aid";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = generateId();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return generateId();
  }
}
var SESSION_TIMEOUT = 30 * 60 * 1e3;
function getSessionId() {
  const sidKey = "_acr_sid";
  const tsKey = "_acr_sid_ts";
  try {
    const now = Date.now();
    const existingSid = sessionStorage.getItem(sidKey);
    const existingTs = sessionStorage.getItem(tsKey);
    if (existingSid && existingTs) {
      const lastActivity = parseInt(existingTs, 10);
      if (now - lastActivity < SESSION_TIMEOUT) {
        sessionStorage.setItem(tsKey, now.toString());
        return existingSid;
      }
    }
    const id = generateId();
    sessionStorage.setItem(sidKey, id);
    sessionStorage.setItem(tsKey, now.toString());
    return id;
  } catch {
    return generateId();
  }
}
function getUtmParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_term: params.get("utm_term") || "",
      utm_content: params.get("utm_content") || ""
    };
  } catch {
    return {
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      utm_term: "",
      utm_content: ""
    };
  }
}
function getPageMeta() {
  try {
    return {
      page_url: window.location.href,
      page_path: window.location.pathname,
      page_title: document.title,
      referrer: document.referrer
    };
  } catch {
    return {
      page_url: "",
      page_path: "",
      page_title: "",
      referrer: ""
    };
  }
}
function getDeviceContext() {
  try {
    const nav = navigator;
    return {
      language: nav.language || "",
      languages: Array.from(nav.languages || []),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      pixel_ratio: window.devicePixelRatio || 1,
      color_depth: screen.colorDepth,
      touch_support: nav.maxTouchPoints > 0,
      connection_type: nav.connection?.effectiveType || "",
      connection_downlink: nav.connection?.downlink ?? null,
      connection_rtt: nav.connection?.rtt ?? null,
      pdf_viewer: nav.pdfViewerEnabled ?? null,
      hardware_concurrency: nav.hardwareConcurrency || null,
      cookie_enabled: nav.cookieEnabled,
      do_not_track: nav.doNotTrack === "1",
      online: nav.onLine
    };
  } catch {
    return {};
  }
}

// src/tracker.ts
var defaultTracker = null;
var DEFAULT_FUNNEL_STEPS = [
  { path: "/contact-us", step: 1, label: "Form Page", event: "funnel_form_page" },
  { path: "/thank-you", step: 2, label: "Form Submitted", event: "funnel_form_submitted" },
  { path: "/thanks-whats-next", step: 3, label: "Booking Confirmed", event: "funnel_booking_confirmed" }
];
var LANDING_PAGE_KEY = "_acr_lp";
var LANDING_REF_KEY = "_acr_lr";
function recordLandingPage() {
  try {
    if (!sessionStorage.getItem(LANDING_PAGE_KEY)) {
      sessionStorage.setItem(LANDING_PAGE_KEY, window.location.href);
      sessionStorage.setItem(LANDING_REF_KEY, document.referrer || "(direct)");
    }
  } catch {
  }
}
function getLandingPage() {
  try {
    return sessionStorage.getItem(LANDING_PAGE_KEY) || "";
  } catch {
    return "";
  }
}
function getLandingReferrer() {
  try {
    return sessionStorage.getItem(LANDING_REF_KEY) || "";
  } catch {
    return "";
  }
}
function createTracker(config) {
  const { siteId, endpoint, apiUrl, batchInterval = 5e3, debug = false } = config;
  const trackUrl = endpoint || `${apiUrl}/api/track`;
  const funnelSteps = config.funnelSteps || DEFAULT_FUNNEL_STEPS;
  let queue = [];
  let flushTimer = null;
  let pageLoadTime = null;
  let isBot = false;
  let engagementStart = Date.now();
  let engagementMs = 0;
  let isVisible = true;
  if (typeof window !== "undefined") {
    const nav = navigator;
    if (nav.webdriver) {
      isBot = true;
    }
  }
  if (typeof performance !== "undefined") {
    pageLoadTime = performance.now();
    if (pageLoadTime < 50) {
      isBot = true;
    }
  }
  if (isBot && debug) {
    console.log("[acr-tracker] Bot detected, skipping tracking");
  }
  if (typeof window !== "undefined") {
    recordLandingPage();
  }
  const deviceContext = typeof window !== "undefined" ? getDeviceContext() : {};
  function log(...args) {
    if (debug) {
      console.log("[acr-tracker]", ...args);
    }
  }
  function getEngagementTime() {
    if (isVisible) {
      return engagementMs + (Date.now() - engagementStart);
    }
    return engagementMs;
  }
  function buildEvent(eventType, extra = {}) {
    const utmParams = getUtmParams();
    const pageMeta = getPageMeta();
    let mergedMeta = {
      ...deviceContext,
      engagement_time_ms: getEngagementTime(),
      landing_page: getLandingPage(),
      landing_referrer: getLandingReferrer()
    };
    if (extra.event_metadata) {
      try {
        const parsed = JSON.parse(extra.event_metadata);
        mergedMeta = { ...mergedMeta, ...parsed };
      } catch {
        mergedMeta.raw_metadata = extra.event_metadata;
      }
    }
    return {
      event_type: eventType,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      session_id: getSessionId(),
      anonymous_id: getAnonymousId(),
      page_url: pageMeta.page_url,
      page_path: pageMeta.page_path,
      page_title: pageMeta.page_title,
      referrer: pageMeta.referrer,
      utm_source: utmParams.utm_source,
      utm_medium: utmParams.utm_medium,
      utm_campaign: utmParams.utm_campaign,
      utm_term: utmParams.utm_term,
      utm_content: utmParams.utm_content,
      screen_width: typeof window !== "undefined" ? window.screen.width : 0,
      screen_height: typeof window !== "undefined" ? window.screen.height : 0,
      scroll_depth: 0,
      time_on_page: pageLoadTime ? Math.round(performance.now() - pageLoadTime) : 0,
      event_value: "",
      ...extra,
      event_metadata: JSON.stringify(mergedMeta)
    };
  }
  function flush() {
    if (queue.length === 0) return;
    const payload = {
      site_id: siteId,
      events: [...queue]
    };
    queue = [];
    const url = trackUrl;
    const body = JSON.stringify(payload);
    log("Flushing", payload.events.length, "events");
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch((err) => {
      log("Flush error:", err);
    });
  }
  function flushBeacon() {
    if (queue.length === 0) return;
    const payload = {
      site_id: siteId,
      events: [...queue]
    };
    const backup = [...queue];
    queue = [];
    const url = trackUrl;
    const body = JSON.stringify(payload);
    log("Beacon flush", payload.events.length, "events");
    let sent = false;
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: "application/json" });
        sent = navigator.sendBeacon(url, blob);
      } catch {
        sent = false;
      }
    }
    if (!sent) {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => {
        queue = backup.concat(queue);
      });
    }
  }
  function enqueue(event) {
    queue.push(event);
    log("Enqueued:", event.event_type);
  }
  function track2(eventType, metadata) {
    if (isBot) return;
    const event = buildEvent(eventType, {
      event_metadata: metadata ? JSON.stringify(metadata) : "{}"
    });
    enqueue(event);
  }
  function trackPageView() {
    if (isBot) return;
    const event = buildEvent("pageview");
    enqueue(event);
  }
  function trackScrollDepth(depth) {
    if (isBot) return;
    const event = buildEvent("scroll_depth", {
      scroll_depth: depth,
      event_value: `${depth}%`
    });
    enqueue(event);
  }
  function trackCWV(metric) {
    if (isBot) return;
    const event = buildEvent("cwv", {
      event_value: metric.value.toString(),
      event_metadata: JSON.stringify({
        metric_name: metric.name,
        metric_value: metric.value
      })
    });
    enqueue(event);
  }
  function trackLead2(data) {
    if (isBot) return;
    const event = buildEvent("lead_submit", {
      event_value: data.source || "",
      event_metadata: JSON.stringify({
        lead_name: data.name || "",
        lead_email: data.email || "",
        lead_phone: data.phone || "",
        lead_message: data.message || "",
        lead_source: data.source || "",
        lead_form_id: data.formId || "",
        // Include any extra fields
        ...Object.fromEntries(
          Object.entries(data).filter(
            ([k]) => !["name", "email", "phone", "message", "source", "formId"].includes(k)
          )
        )
      })
    });
    enqueue(event);
    flush();
    log("Lead tracked and flushed immediately");
  }
  function normPath(p) {
    const lower = p.toLowerCase();
    return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
  }
  function checkFunnelStep() {
    if (isBot) return;
    const currentPath = typeof window !== "undefined" ? normPath(window.location.pathname) : "";
    if (!currentPath) return;
    for (const step of funnelSteps) {
      const stepPath = normPath(step.path);
      const matches = step.path.endsWith("*") ? currentPath.startsWith(step.path.slice(0, -1)) : currentPath === stepPath;
      if (matches) {
        const event = buildEvent(step.event, {
          event_value: `step_${step.step}`,
          event_metadata: JSON.stringify({
            funnel_step: step.step,
            funnel_label: step.label,
            funnel_path: step.path
          })
        });
        enqueue(event);
        log(`Funnel step ${step.step} matched: ${step.label} (${step.path})`);
        if (step.step >= 3) {
          flush();
        }
        break;
      }
    }
  }
  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      if (isVisible) {
        engagementMs += Date.now() - engagementStart;
        isVisible = false;
      }
      flushBeacon();
    } else {
      engagementStart = Date.now();
      isVisible = true;
    }
  }
  function handleBeforeUnload() {
    flushBeacon();
  }
  if (typeof window !== "undefined") {
    flushTimer = setInterval(flush, batchInterval);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }
  function destroy() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flushBeacon();
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  }
  const tracker = {
    track: track2,
    trackPageView,
    trackScrollDepth,
    trackCWV,
    trackLead: trackLead2,
    checkFunnelStep,
    flush,
    destroy
  };
  defaultTracker = tracker;
  return tracker;
}
function track(eventType, metadata) {
  if (!defaultTracker) {
    console.warn(
      "[acr-tracker] No tracker initialized. Call createTracker() first."
    );
    return;
  }
  defaultTracker.track(eventType, metadata);
}
function trackLead(data) {
  if (!defaultTracker) {
    console.warn(
      "[acr-tracker] No tracker initialized. Call createTracker() first."
    );
    return;
  }
  defaultTracker.trackLead(data);
}

// src/AcrTracker.tsx
var SCROLL_THRESHOLDS = [25, 50, 75, 100];
function AcrTracker({
  siteId,
  endpoint,
  apiUrl,
  batchInterval,
  debug,
  funnelSteps
}) {
  const pathname = usePathname();
  const trackerRef = useRef(null);
  const reachedThresholdsRef = useRef(/* @__PURE__ */ new Set());
  const throttleRef = useRef(false);
  useEffect(() => {
    const config = {
      siteId,
      endpoint,
      apiUrl,
      batchInterval,
      debug,
      funnelSteps
    };
    trackerRef.current = createTracker(config);
    trackerRef.current.trackPageView();
    trackerRef.current.checkFunnelStep();
    import("web-vitals").then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const tracker = trackerRef.current;
      if (!tracker) return;
      const reportCWV = (metric) => {
        tracker.trackCWV(metric);
      };
      onCLS(reportCWV);
      onINP(reportCWV);
      onLCP(reportCWV);
      onFCP(reportCWV);
      onTTFB(reportCWV);
    }).catch(() => {
      if (debug) {
        console.warn("[acr-tracker] Failed to load web-vitals library");
      }
    });
    return () => {
      trackerRef.current?.destroy();
      trackerRef.current = null;
    };
  }, []);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    reachedThresholdsRef.current.clear();
    trackerRef.current?.trackPageView();
    trackerRef.current?.checkFunnelStep();
  }, [pathname]);
  const handleScroll = useCallback(() => {
    if (throttleRef.current) return;
    throttleRef.current = true;
    requestAnimationFrame(() => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      const winHeight = window.innerHeight;
      const scrollableHeight = docHeight - winHeight;
      const scrollPercent = scrollableHeight > 0 ? Math.round(scrollTop / scrollableHeight * 100) : 100;
      for (const threshold of SCROLL_THRESHOLDS) {
        if (scrollPercent >= threshold && !reachedThresholdsRef.current.has(threshold)) {
          reachedThresholdsRef.current.add(threshold);
          trackerRef.current?.trackScrollDepth(threshold);
        }
      }
      throttleRef.current = false;
    });
  }, []);
  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);
  useEffect(() => {
    const handleClick = (e) => {
      const anchor = e.target.closest?.("a");
      if (!anchor) return;
      const href = anchor.href;
      if (!href) return;
      try {
        const linkUrl = new URL(href, window.location.origin);
        const isOutbound = linkUrl.hostname !== window.location.hostname;
        const isDownload = /\.(pdf|zip|doc|docx|xls|xlsx|csv|ppt|pptx)$/i.test(linkUrl.pathname);
        const isMailto = href.startsWith("mailto:");
        const isTel = href.startsWith("tel:");
        if (isOutbound || isDownload || isMailto || isTel) {
          trackerRef.current?.track(
            isOutbound ? "outbound_click" : isDownload ? "download_click" : isMailto ? "mailto_click" : "tel_click",
            {
              link_url: href,
              link_text: (anchor.textContent || "").slice(0, 200).trim(),
              link_domain: isOutbound ? linkUrl.hostname : "",
              link_classes: anchor.className || "",
              link_id: anchor.id || ""
            }
          );
        }
      } catch {
      }
    };
    document.addEventListener("click", handleClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);
  const trackedFormsRef = useRef(/* @__PURE__ */ new Set());
  useEffect(() => {
    trackedFormsRef.current.clear();
    function getFormFingerprint(form, idx) {
      return `${form.id || ""}|${form.getAttribute("name") || ""}|${form.action || ""}|${idx}`;
    }
    function getFormMeta(form, idx) {
      const rect = form.getBoundingClientRect();
      return {
        form_id: form.id || "",
        form_name: form.getAttribute("name") || "",
        form_action: form.action || "",
        form_classes: form.className || "",
        form_index: idx,
        field_count: form.elements.length,
        form_visible: rect.width > 0 && rect.height > 0,
        form_position_y: Math.round(rect.top + window.scrollY)
      };
    }
    function scanForms() {
      const forms = document.querySelectorAll("form");
      forms.forEach((form, idx) => {
        const fp = getFormFingerprint(form, idx);
        if (trackedFormsRef.current.has(fp)) return;
        trackedFormsRef.current.add(fp);
        const meta = getFormMeta(form, idx);
        trackerRef.current?.track("form_view", {
          ...meta,
          forms_on_page: forms.length
        });
      });
    }
    const timer = setTimeout(scanForms, 500);
    const observer = new MutationObserver((mutations) => {
      let hasNewForm = false;
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLFormElement) {
            hasNewForm = true;
          } else if (node instanceof HTMLElement && node.querySelector("form")) {
            hasNewForm = true;
          }
        }
      }
      if (hasNewForm) scanForms();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [pathname]);
  useEffect(() => {
    const CTA_PATTERNS = /\b(get.started|book|schedule|sign.up|register|subscribe|contact|free.trial|request|demo|apply|join|start|try|learn.more|find.out|call|hire|pricing)\b/i;
    function isCTA(el) {
      if (el.tagName === "BUTTON" && !el.closest("form")) return true;
      const classes = el.className || "";
      if (/\b(cta|btn|button|hero|action)\b/i.test(classes)) return true;
      const text = (el.textContent || "").trim();
      if (text.length > 0 && text.length < 80 && CTA_PATTERNS.test(text)) return true;
      if (el.getAttribute("role") === "button") return true;
      return false;
    }
    function getCtaInfo(el) {
      const text = (el.textContent || "").slice(0, 200).trim();
      const href = el.href || "";
      return {
        cta_text: text,
        cta_tag: el.tagName.toLowerCase(),
        cta_id: el.id || "",
        cta_classes: (el.className || "").slice(0, 200),
        cta_href: href,
        cta_position_y: Math.round(el.getBoundingClientRect().top + window.scrollY)
      };
    }
    const handleCtaClick = (e) => {
      const target = e.target;
      const el = target.closest('a, button, [role="button"]');
      if (!el || !isCTA(el)) return;
      const info = getCtaInfo(el);
      trackerRef.current?.track("cta_click", info);
      try {
        sessionStorage.setItem("_acr_last_cta", JSON.stringify({
          text: info.cta_text,
          href: info.cta_href,
          id: info.cta_id,
          timestamp: Date.now()
        }));
      } catch {
      }
    };
    document.addEventListener("click", handleCtaClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleCtaClick, { capture: true });
    };
  }, []);
  useEffect(() => {
    function getLastCta() {
      try {
        const raw = sessionStorage.getItem("_acr_last_cta");
        if (!raw) return null;
        const cta = JSON.parse(raw);
        if (Date.now() - cta.timestamp > 30 * 60 * 1e3) return null;
        return cta;
      } catch {
        return null;
      }
    }
    const handleSubmit = (e) => {
      const form = e.target;
      if (!form?.tagName || form.tagName !== "FORM") return;
      const lastCta = getLastCta();
      trackerRef.current?.track("form_submit", {
        form_id: form.id || "",
        form_action: form.action || "",
        form_method: form.method || "",
        form_name: form.getAttribute("name") || "",
        form_classes: form.className || "",
        field_count: form.elements.length,
        ...lastCta ? {
          attributed_cta_text: lastCta.text,
          attributed_cta_href: lastCta.href,
          attributed_cta_id: lastCta.id
        } : {}
      });
    };
    document.addEventListener("submit", handleSubmit, { capture: true });
    return () => {
      document.removeEventListener("submit", handleSubmit, { capture: true });
    };
  }, []);
  useEffect(() => {
    const handleError = (e) => {
      trackerRef.current?.track("js_error", {
        error_message: e.message || "",
        error_source: e.filename || "",
        error_line: e.lineno || 0,
        error_col: e.colno || 0
      });
    };
    const handleRejection = (e) => {
      trackerRef.current?.track("unhandled_rejection", {
        error_message: String(e.reason?.message || e.reason || "")
      });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);
  return null;
}
export {
  AcrTracker,
  createTracker,
  track,
  trackLead
};
