'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { createTracker, type Tracker } from './tracker';
import type { TrackerConfig } from './types';

export interface AcrTrackerProps {
  siteId: string;
  /** Full tracking endpoint path (e.g., '/ingest/track' for proxy mode) */
  endpoint?: string;
  /** @deprecated Use `endpoint` instead. Base URL for direct API access. */
  apiUrl?: string;
  batchInterval?: number;
  debug?: boolean;
}

const SCROLL_THRESHOLDS = [25, 50, 75, 100];

export function AcrTracker({
  siteId,
  endpoint,
  apiUrl,
  batchInterval,
  debug,
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
    };

    trackerRef.current = createTracker(config);

    // Track initial page view
    trackerRef.current.trackPageView();

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
      const scrollPercent = Math.round(
        (scrollTop / (docHeight - winHeight)) * 100
      );

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

  return null;
}
