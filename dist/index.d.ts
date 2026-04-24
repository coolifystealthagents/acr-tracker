interface FunnelStep {
    /** URL path pattern (exact match or starts-with if ends with *) */
    path: string;
    /** Step number in the funnel (1-based) */
    step: number;
    /** Human-readable label */
    label: string;
    /** Event name to emit */
    event: string;
}
interface TrackerConfig {
    siteId: string;
    /** Full tracking endpoint path (e.g., '/ingest/track' for proxy mode) */
    endpoint?: string;
    /** @deprecated Use `endpoint` instead. Base URL for direct API access. */
    apiUrl?: string;
    batchInterval?: number;
    debug?: boolean;
    /**
     * Conversion funnel steps. When the user navigates to a matching path,
     * the tracker automatically fires the corresponding funnel event.
     * Default: standard ACR 3-step lead funnel.
     */
    funnelSteps?: FunnelStep[];
}
interface LeadData {
    /** Contact name */
    name?: string;
    /** Contact email */
    email?: string;
    /** Contact phone */
    phone?: string;
    /** Form message / inquiry */
    message?: string;
    /** Which CTA / form source (e.g., 'homepage-hero', 'contact-page') */
    source?: string;
    /** The form element ID or name */
    formId?: string;
    /** Any additional fields */
    [key: string]: unknown;
}
interface TrackEvent {
    event_type: string;
    timestamp: string;
    session_id: string;
    anonymous_id: string;
    page_url: string;
    page_path: string;
    page_title: string;
    referrer: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_term: string;
    utm_content: string;
    screen_width: number;
    screen_height: number;
    scroll_depth: number;
    time_on_page: number;
    event_value: string;
    event_metadata: string;
    _hp?: string;
}
interface TrackPayload {
    site_id: string;
    events: TrackEvent[];
}

interface AcrTrackerProps {
    siteId: string;
    /** Full tracking endpoint path (e.g., '/ingest/track' for proxy mode) */
    endpoint?: string;
    /** @deprecated Use `endpoint` instead. Base URL for direct API access. */
    apiUrl?: string;
    batchInterval?: number;
    debug?: boolean;
    /** Custom funnel steps (default: ACR 3-step lead funnel) */
    funnelSteps?: FunnelStep[];
}
declare function AcrTracker({ siteId, endpoint, apiUrl, batchInterval, debug, funnelSteps, }: AcrTrackerProps): null;

interface Tracker {
    track: (eventType: string, metadata?: Record<string, unknown>) => void;
    trackPageView: () => void;
    trackScrollDepth: (depth: number) => void;
    trackCWV: (metric: {
        name: string;
        value: number;
    }) => void;
    trackLead: (data: LeadData) => void;
    checkFunnelStep: () => void;
    flush: () => void;
    destroy: () => void;
}
/**
 * Create an analytics tracker instance.
 */
declare function createTracker(config: TrackerConfig): Tracker;
/**
 * Track an event using the default tracker instance.
 * Must call createTracker() first.
 */
declare function track(eventType: string, metadata?: Record<string, unknown>): void;
/**
 * Track a lead using the default tracker instance.
 * Immediately flushes — lead events are time-sensitive.
 * Must call createTracker() first.
 */
declare function trackLead(data: LeadData): void;

export { AcrTracker, type FunnelStep, type LeadData, type TrackEvent, type TrackPayload, type TrackerConfig, createTracker, track, trackLead };
