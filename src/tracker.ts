import type { TrackerConfig, TrackEvent, TrackPayload, LeadData, FunnelStep } from './types';
import {
  getAnonymousId,
  getSessionId,
  getUtmParams,
  getPageMeta,
  getDeviceContext,
} from './utils';

export interface Tracker {
  track: (eventType: string, metadata?: Record<string, unknown>) => void;
  trackPageView: () => void;
  trackScrollDepth: (depth: number) => void;
  trackCWV: (metric: { name: string; value: number }) => void;
  trackLead: (data: LeadData) => void;
  checkFunnelStep: () => void;
  flush: () => void;
  destroy: () => void;
}

let defaultTracker: Tracker | null = null;

/** Default 3-step lead funnel for ACR sites */
const DEFAULT_FUNNEL_STEPS: FunnelStep[] = [
  { path: '/contact-us', step: 1, label: 'Form Page', event: 'funnel_form_page' },
  { path: '/thank-you', step: 2, label: 'Form Submitted', event: 'funnel_form_submitted' },
  { path: '/thanks-whats-next', step: 3, label: 'Booking Confirmed', event: 'funnel_booking_confirmed' },
];

const LANDING_PAGE_KEY = '_acr_lp';
const LANDING_REF_KEY = '_acr_lr';

/**
 * Record the landing page (first page of the visit).
 * Only set once per session.
 */
function recordLandingPage(): void {
  try {
    if (!sessionStorage.getItem(LANDING_PAGE_KEY)) {
      sessionStorage.setItem(LANDING_PAGE_KEY, window.location.href);
      sessionStorage.setItem(LANDING_REF_KEY, document.referrer || '(direct)');
    }
  } catch {
    // sessionStorage unavailable
  }
}

function getLandingPage(): string {
  try {
    return sessionStorage.getItem(LANDING_PAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getLandingReferrer(): string {
  try {
    return sessionStorage.getItem(LANDING_REF_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Create an analytics tracker instance.
 */
export function createTracker(config: TrackerConfig): Tracker {
  const { siteId, endpoint, apiUrl, batchInterval = 5000, debug = false } = config;
  const trackUrl = endpoint || `${apiUrl}/api/track`;
  const funnelSteps = config.funnelSteps || DEFAULT_FUNNEL_STEPS;

  let queue: TrackEvent[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let pageLoadTime: number | null = null;
  let isBot = false;
  let engagementStart = Date.now();
  let engagementMs = 0;
  let isVisible = true;

  // Bot detection: check for headless browser indicators
  if (typeof window !== 'undefined') {
    const nav = navigator as Navigator & { webdriver?: boolean };
    // navigator.webdriver is true in automated browsers (Puppeteer, Playwright, Selenium)
    if (nav.webdriver) {
      isBot = true;
    }
  }
  if (typeof performance !== 'undefined') {
    pageLoadTime = performance.now();
    // Only flag as bot if page loaded impossibly fast (<50ms) — a sign of headless execution.
    // Normal cached pages can load in 200-800ms; 500ms threshold was too aggressive.
    if (pageLoadTime < 50) {
      isBot = true;
    }
  }
  if (isBot && debug) {
    console.log('[acr-tracker] Bot detected, skipping tracking');
  }

  // Record landing page on init
  if (typeof window !== 'undefined') {
    recordLandingPage();
  }

  // Cache device context once per tracker init (doesn't change per event)
  const deviceContext = typeof window !== 'undefined' ? getDeviceContext() : {};

  function log(...args: unknown[]) {
    if (debug) {
      console.log('[acr-tracker]', ...args);
    }
  }

  function getEngagementTime(): number {
    if (isVisible) {
      return engagementMs + (Date.now() - engagementStart);
    }
    return engagementMs;
  }

  function buildEvent(
    eventType: string,
    extra: Partial<TrackEvent> = {}
  ): TrackEvent {
    const utmParams = getUtmParams();
    const pageMeta = getPageMeta();

    // Merge device context + attribution + any extra metadata
    let mergedMeta: Record<string, unknown> = {
      ...deviceContext,
      engagement_time_ms: getEngagementTime(),
      landing_page: getLandingPage(),
      landing_referrer: getLandingReferrer(),
    };

    // If extra has event_metadata, parse and merge it
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
      timestamp: new Date().toISOString(),
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
      screen_width: typeof window !== 'undefined' ? window.screen.width : 0,
      screen_height: typeof window !== 'undefined' ? window.screen.height : 0,
      scroll_depth: 0,
      time_on_page: pageLoadTime ? Math.round(performance.now() - pageLoadTime) : 0,
      event_value: '',
      ...extra,
      event_metadata: JSON.stringify(mergedMeta),
    };
  }

  function flush(): void {
    if (queue.length === 0) return;

    const payload: TrackPayload = {
      site_id: siteId,
      events: [...queue],
    };

    queue = [];
    const url = trackUrl;
    const body = JSON.stringify(payload);

    log('Flushing', payload.events.length, 'events');

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch((err) => {
      log('Flush error:', err);
    });
  }

  function flushBeacon(): void {
    if (queue.length === 0) return;

    const payload: TrackPayload = {
      site_id: siteId,
      events: [...queue],
    };

    queue = [];
    const url = trackUrl;
    const body = JSON.stringify(payload);

    log('Beacon flush', payload.events.length, 'events');

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }

  function enqueue(event: TrackEvent): void {
    queue.push(event);
    log('Enqueued:', event.event_type);
  }

  function track(
    eventType: string,
    metadata?: Record<string, unknown>
  ): void {
    if (isBot) return;

    const event = buildEvent(eventType, {
      event_metadata: metadata ? JSON.stringify(metadata) : '{}',
    });

    enqueue(event);
  }

  function trackPageView(): void {
    if (isBot) return;

    const event = buildEvent('pageview');
    enqueue(event);
  }

  function trackScrollDepth(depth: number): void {
    if (isBot) return;

    const event = buildEvent('scroll_depth', {
      scroll_depth: depth,
      event_value: `${depth}%`,
    });
    enqueue(event);
  }

  function trackCWV(metric: { name: string; value: number }): void {
    if (isBot) return;

    const event = buildEvent('cwv', {
      event_value: metric.value.toString(),
      event_metadata: JSON.stringify({
        metric_name: metric.name,
        metric_value: metric.value,
      }),
    });
    enqueue(event);
  }

  /**
   * Track a lead submission with detailed contact/form data.
   * Immediately flushes — lead events are time-sensitive.
   */
  function trackLead(data: LeadData): void {
    if (isBot) return;

    const event = buildEvent('lead_submit', {
      event_value: data.source || '',
      event_metadata: JSON.stringify({
        lead_name: data.name || '',
        lead_email: data.email || '',
        lead_phone: data.phone || '',
        lead_message: data.message || '',
        lead_source: data.source || '',
        lead_form_id: data.formId || '',
        // Include any extra fields
        ...Object.fromEntries(
          Object.entries(data).filter(
            ([k]) => !['name', 'email', 'phone', 'message', 'source', 'formId'].includes(k)
          )
        ),
      }),
    });

    enqueue(event);
    // Immediately flush — leads are time-sensitive
    flush();
    log('Lead tracked and flushed immediately');
  }

  /**
   * Check if the current page matches a funnel step and fire the event.
   * Called automatically on each page view.
   */
  function checkFunnelStep(): void {
    if (isBot) return;

    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    if (!currentPath) return;

    for (const step of funnelSteps) {
      const matches = step.path.endsWith('*')
        ? currentPath.startsWith(step.path.slice(0, -1))
        : currentPath === step.path;

      if (matches) {
        const event = buildEvent(step.event, {
          event_value: `step_${step.step}`,
          event_metadata: JSON.stringify({
            funnel_step: step.step,
            funnel_label: step.label,
            funnel_path: step.path,
          }),
        });
        enqueue(event);
        log(`Funnel step ${step.step} matched: ${step.label} (${step.path})`);

        // For conversion steps (step 3+), flush immediately
        if (step.step >= 3) {
          flush();
        }
        break;
      }
    }
  }

  // Handle page visibility (engagement time + flush)
  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      // Accumulate engagement time
      if (isVisible) {
        engagementMs += Date.now() - engagementStart;
        isVisible = false;
      }
      flushBeacon();
    } else {
      // Page became visible again
      engagementStart = Date.now();
      isVisible = true;
    }
  }

  function handleBeforeUnload(): void {
    flushBeacon();
  }

  // Start batch interval
  if (typeof window !== 'undefined') {
    flushTimer = setInterval(flush, batchInterval);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
  }

  function destroy(): void {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flushBeacon();

    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }

  const tracker: Tracker = {
    track,
    trackPageView,
    trackScrollDepth,
    trackCWV,
    trackLead,
    checkFunnelStep,
    flush,
    destroy,
  };

  // Set as default tracker
  defaultTracker = tracker;

  return tracker;
}

/**
 * Track an event using the default tracker instance.
 * Must call createTracker() first.
 */
export function track(
  eventType: string,
  metadata?: Record<string, unknown>
): void {
  if (!defaultTracker) {
    console.warn(
      '[acr-tracker] No tracker initialized. Call createTracker() first.'
    );
    return;
  }
  defaultTracker.track(eventType, metadata);
}

/**
 * Track a lead using the default tracker instance.
 * Immediately flushes — lead events are time-sensitive.
 * Must call createTracker() first.
 */
export function trackLead(data: LeadData): void {
  if (!defaultTracker) {
    console.warn(
      '[acr-tracker] No tracker initialized. Call createTracker() first.'
    );
    return;
  }
  defaultTracker.trackLead(data);
}
