/**
 * Generate a unique ID using crypto.randomUUID().
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get or create an anonymous ID stored in localStorage.
 * Persists across sessions until the user clears storage.
 */
export function getAnonymousId(): string {
  const key = '_acr_aid';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = generateId();
    localStorage.setItem(key, id);
    return id;
  } catch {
    // localStorage unavailable (SSR, incognito limits, etc.)
    return generateId();
  }
}

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Get or create a session ID stored in sessionStorage.
 * Expires after 30 minutes of inactivity.
 */
export function getSessionId(): string {
  const sidKey = '_acr_sid';
  const tsKey = '_acr_sid_ts';

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

    // Create new session
    const id = generateId();
    sessionStorage.setItem(sidKey, id);
    sessionStorage.setItem(tsKey, now.toString());
    return id;
  } catch {
    return generateId();
  }
}

/**
 * Parse UTM parameters from the current URL.
 */
export function getUtmParams(): {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term: params.get('utm_term') || '',
      utm_content: params.get('utm_content') || '',
    };
  } catch {
    return {
      utm_source: '',
      utm_medium: '',
      utm_campaign: '',
      utm_term: '',
      utm_content: '',
    };
  }
}

/**
 * Get current page metadata.
 */
export function getPageMeta(): {
  page_url: string;
  page_path: string;
  page_title: string;
  referrer: string;
} {
  try {
    return {
      page_url: window.location.href,
      page_path: window.location.pathname,
      page_title: document.title,
      referrer: document.referrer,
    };
  } catch {
    return {
      page_url: '',
      page_path: '',
      page_title: '',
      referrer: '',
    };
  }
}
