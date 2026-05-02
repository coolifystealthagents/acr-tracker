'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { createTracker, type Tracker } from './tracker';
import type { TrackerConfig, FunnelStep } from './types';

export interface AcrTrackerProps {
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

const SCROLL_THRESHOLDS = [25, 50, 75, 100];

export function AcrTracker({
  siteId,
  endpoint,
  apiUrl,
  batchInterval,
  debug,
  funnelSteps,
}: AcrTrackerProps) {
  const pathname = usePathname();
  const trackerRef = useRef<Tracker | null>(null);
  const reachedThresholdsRef = useRef<Set<number>>(new Set());
  const throttleRef = useRef(false);

  // Initialize tracker once
  useEffect(() => {
    const config: TrackerConfig = {
      siteId,
      endpoint,
      apiUrl,
      batchInterval,
      debug,
      funnelSteps,
    };

    trackerRef.current = createTracker(config);

    // Track initial page view + check funnel
    trackerRef.current.trackPageView();
    trackerRef.current.checkFunnelStep();

    // Load Core Web Vitals
    import('web-vitals')
      .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
        const tracker = trackerRef.current;
        if (!tracker) return;

        const reportCWV = (metric: { name: string; value: number }) => {
          tracker.trackCWV(metric);
        };

        onCLS(reportCWV);
        onINP(reportCWV);
        onLCP(reportCWV);
        onFCP(reportCWV);
        onTTFB(reportCWV);
      })
      .catch(() => {
        if (debug) {
          console.warn('[acr-tracker] Failed to load web-vitals library');
        }
      });

    return () => {
      trackerRef.current?.destroy();
      trackerRef.current = null;
    };
    // Only run on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track page views on route change (skip initial since we already tracked it)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Reset scroll thresholds on route change
    reachedThresholdsRef.current.clear();

    trackerRef.current?.trackPageView();
    trackerRef.current?.checkFunnelStep();
  }, [pathname]);

  // Scroll depth tracking
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
      const scrollPercent = scrollableHeight > 0
        ? Math.round((scrollTop / scrollableHeight) * 100)
        : 100;

      for (const threshold of SCROLL_THRESHOLDS) {
        if (
          scrollPercent >= threshold &&
          !reachedThresholdsRef.current.has(threshold)
        ) {
          reachedThresholdsRef.current.add(threshold);
          trackerRef.current?.trackScrollDepth(threshold);
        }
      }

      throttleRef.current = false;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // Outbound link click tracking
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.('a');
      if (!anchor) return;

      const href = anchor.href;
      if (!href) return;

      try {
        const linkUrl = new URL(href, window.location.origin);
        const isOutbound = linkUrl.hostname !== window.location.hostname;
        const isDownload = /\.(pdf|zip|doc|docx|xls|xlsx|csv|ppt|pptx)$/i.test(linkUrl.pathname);
        const isMailto = href.startsWith('mailto:');
        const isTel = href.startsWith('tel:');

        if (isOutbound || isDownload || isMailto || isTel) {
          trackerRef.current?.track(
            isOutbound ? 'outbound_click' : isDownload ? 'download_click' : isMailto ? 'mailto_click' : 'tel_click',
            {
              link_url: href,
              link_text: (anchor.textContent || '').slice(0, 200).trim(),
              link_domain: isOutbound ? linkUrl.hostname : '',
              link_classes: anchor.className || '',
              link_id: anchor.id || '',
            }
          );
        }
      } catch {
        // Invalid URL, skip
      }
    };

    document.addEventListener('click', handleClick, { capture: true });
    return () => {
      document.removeEventListener('click', handleClick, { capture: true });
    };
  }, []);

  // Form view detection — fire form_view when a page has forms
  const trackedFormsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Reset tracked forms on route change
    trackedFormsRef.current.clear();

    function getFormFingerprint(form: HTMLFormElement, idx: number): string {
      return `${form.id || ''}|${form.getAttribute('name') || ''}|${form.action || ''}|${idx}`;
    }

    function getFormMeta(form: HTMLFormElement, idx: number) {
      const rect = form.getBoundingClientRect();
      return {
        form_id: form.id || '',
        form_name: form.getAttribute('name') || '',
        form_action: form.action || '',
        form_classes: form.className || '',
        form_index: idx,
        field_count: form.elements.length,
        form_visible: rect.width > 0 && rect.height > 0,
        form_position_y: Math.round(rect.top + window.scrollY),
      };
    }

    function scanForms() {
      const forms = document.querySelectorAll('form');
      forms.forEach((form, idx) => {
        const fp = getFormFingerprint(form as HTMLFormElement, idx);
        if (trackedFormsRef.current.has(fp)) return;
        trackedFormsRef.current.add(fp);

        const meta = getFormMeta(form as HTMLFormElement, idx);
        trackerRef.current?.track('form_view', {
          ...meta,
          forms_on_page: forms.length,
        });
      });
    }

    // Scan after a short delay to let the page render
    const timer = setTimeout(scanForms, 500);

    // Also watch for dynamically inserted forms
    const observer = new MutationObserver((mutations) => {
      let hasNewForm = false;
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLFormElement) {
            hasNewForm = true;
          } else if (node instanceof HTMLElement && node.querySelector('form')) {
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

  // CTA click tracking — detect button/link clicks and store for form attribution
  useEffect(() => {
    const CTA_PATTERNS = /\b(get.started|book|schedule|sign.up|register|subscribe|contact|free.trial|request|demo|apply|join|start|try|learn.more|find.out|call|hire|pricing)\b/i;

    function isCTA(el: HTMLElement): boolean {
      // Buttons outside forms are CTAs
      if (el.tagName === 'BUTTON' && !el.closest('form')) return true;
      // Links/buttons with CTA-like classes
      const classes = el.className || '';
      if (/\b(cta|btn|button|hero|action)\b/i.test(classes)) return true;
      // Links/buttons with CTA-like text
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 80 && CTA_PATTERNS.test(text)) return true;
      // Elements with role="button"
      if (el.getAttribute('role') === 'button') return true;
      return false;
    }

    function getCtaInfo(el: HTMLElement) {
      const text = (el.textContent || '').slice(0, 200).trim();
      const href = (el as HTMLAnchorElement).href || '';
      return {
        cta_text: text,
        cta_tag: el.tagName.toLowerCase(),
        cta_id: el.id || '',
        cta_classes: (el.className || '').slice(0, 200),
        cta_href: href,
        cta_position_y: Math.round(el.getBoundingClientRect().top + window.scrollY),
      };
    }

    const handleCtaClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Walk up to find the CTA element (button or anchor)
      const el = target.closest('a, button, [role="button"]') as HTMLElement | null;
      if (!el || !isCTA(el)) return;

      const info = getCtaInfo(el);
      trackerRef.current?.track('cta_click', info);

      // Store last CTA for form attribution
      try {
        sessionStorage.setItem('_acr_last_cta', JSON.stringify({
          text: info.cta_text,
          href: info.cta_href,
          id: info.cta_id,
          timestamp: Date.now(),
        }));
      } catch { /* sessionStorage unavailable */ }
    };

    document.addEventListener('click', handleCtaClick, { capture: true });
    return () => {
      document.removeEventListener('click', handleCtaClick, { capture: true });
    };
  }, []);

  // Form interaction tracking — includes CTA attribution
  useEffect(() => {
    function getLastCta(): Record<string, unknown> | null {
      try {
        const raw = sessionStorage.getItem('_acr_last_cta');
        if (!raw) return null;
        const cta = JSON.parse(raw);
        // Only attribute if CTA was clicked within last 30 minutes
        if (Date.now() - cta.timestamp > 30 * 60 * 1000) return null;
        return cta;
      } catch { return null; }
    }

    const handleSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!form?.tagName || form.tagName !== 'FORM') return;

      const lastCta = getLastCta();
      trackerRef.current?.track('form_submit', {
        form_id: form.id || '',
        form_action: form.action || '',
        form_method: form.method || '',
        form_name: form.getAttribute('name') || '',
        form_classes: form.className || '',
        field_count: form.elements.length,
        ...(lastCta ? {
          attributed_cta_text: lastCta.text,
          attributed_cta_href: lastCta.href,
          attributed_cta_id: lastCta.id,
        } : {}),
      });
    };

    document.addEventListener('submit', handleSubmit, { capture: true });
    return () => {
      document.removeEventListener('submit', handleSubmit, { capture: true });
    };
  }, []);

  // JS error tracking
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      trackerRef.current?.track('js_error', {
        error_message: e.message || '',
        error_source: e.filename || '',
        error_line: e.lineno || 0,
        error_col: e.colno || 0,
      });
    };

    const handleRejection = (e: PromiseRejectionEvent) => {
      trackerRef.current?.track('unhandled_rejection', {
        error_message: String(e.reason?.message || e.reason || ''),
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
