import type { TrackerConfig, TrackEvent, TrackPayload } from './types';
import {
  getAnonymousId,
  getSessionId,
  getUtmParams,
  getPageMeta,
} from './utils';

export interface Tracker {
  track: (eventType: string, metadata?: Record<string, unknown>) => void;
  trackPageView: () => void;
  trackScrollDepth: (depth: number) => void;
  trackCWV: (metric: { name: string; value: number }) => void;
  flush: () => void;
  destroy: () => void;
}

let defaultTracker: Tracker | null = null;

/**
 * Create an analytics tracker instance.
 */
export function createTracker(config: TrackerConfig): Tracker {
  const { siteId, endpoint, apiUrl, batchInterval = 5000, debug = false } = config;
  const trackUrl = endpoint || `${apiUrl}/api/track`;

  let queue: TrackEvent[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let pageLoadTime: number | null = null;
  let isBot = false;

  // Bot detection: if the page loaded suspiciously fast (< 500ms)
  if (typeof performance !== 'undefined') {
    pageLoadTime = performance.now();
    if (pageLoadTime < 500) {
      isBot = true;
      if (debug) {
        console.log('[acr-tracker] Bot detected, skipping tracking');
      }
    }
  }

  function log(...args: unknown[]) {
    if (debug) {
      console.log('[acr-tracker]', ...args);
    }
  }

  function buildEvent(
    eventType: string,
    extra: Partial<TrackEvent> = {}
  ): TrackEvent {
    const utmParams = getUtmParams();
    const pageMeta = getPageMeta();

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
      event_metadata: '',
      ...extra,
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
      event_metadata: metadata ? JSON.stringify(metadata) : '',
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

  // Handle page unload
  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      flushBeacon();
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
