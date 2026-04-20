export interface TrackerConfig {
  siteId: string;
  /** Full tracking endpoint path (e.g., '/ingest/track' for proxy mode) */
  endpoint?: string;
  /** @deprecated Use `endpoint` instead. Base URL for direct API access. */
  apiUrl?: string;
  batchInterval?: number; // ms, default 5000
  debug?: boolean;
}

export interface TrackEvent {
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
  _hp?: string; // honeypot
}

export interface TrackPayload {
  site_id: string;
  events: TrackEvent[];
}
