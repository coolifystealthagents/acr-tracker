# @acr/tracker

Lightweight first-party analytics tracker for ACR Next.js App Router sites. Designed for ad-blocker resistance via first-party proxy architecture.

## Installation

```bash
npm install coolifystealthagents/acr-tracker
```

## Usage

### Next.js App Router (Recommended)

Add the `AcrTracker` component to your root layout:

```tsx
// app/layout.tsx
import { AcrTracker } from '@acr/tracker';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AcrTracker
          siteId="your-site-id"
          endpoint="/ingest/track"
        />
      </body>
    </html>
  );
}
```

This requires a Next.js rewrite in your `next.config.js`:

```js
async rewrites() {
  return [
    {
      source: '/ingest/track',
      destination: 'http://your-tracking-api:8001/api/track',
    },
  ];
}
```

### Automatic Tracking

The `AcrTracker` component auto-tracks:

| Event | Trigger | Data |
|-------|---------|------|
| `pageview` | Every route change | URL, path, title, referrer, UTM params |
| `scroll_depth` | 25%, 50%, 75%, 100% scroll | Scroll percentage |
| `cwv` | Core Web Vitals load | CLS, INP, LCP, FCP, TTFB |
| `outbound_click` | Click on external link | Link URL, text, domain |
| `download_click` | Click on download link | File URL, link text |
| `mailto_click` | Click on mailto link | Email link |
| `tel_click` | Click on tel link | Phone link |
| `form_submit` | HTML form submission | Form ID, action, method, field count |
| `js_error` | Unhandled JS error | Error message, source, line, column |
| `unhandled_rejection` | Unhandled promise rejection | Error message |

### Device Context (Every Event)

Every event automatically includes rich device context in `event_metadata`:

- `language` / `languages` -- browser language preferences
- `timezone` -- user timezone (e.g., `America/New_York`)
- `viewport_width` / `viewport_height` -- actual browser viewport size
- `pixel_ratio` -- device pixel ratio (retina detection)
- `color_depth` -- screen color depth
- `touch_support` -- touchscreen capability
- `connection_type` -- network type (4g, 3g, wifi)
- `connection_downlink` / `connection_rtt` -- network speed metrics
- `hardware_concurrency` -- CPU core count
- `online` -- network connectivity status
- `engagement_time_ms` -- active time on page (paused when tab is hidden)

### Custom Events

```tsx
import { track } from '@acr/tracker';

// Track a custom event
track('button_click', { button_id: 'cta-hero', variant: 'blue' });

// Track a booking conversion
track('booking_conversion', { plan: 'premium' });
```

### Programmatic Tracker

```tsx
import { createTracker } from '@acr/tracker';

const tracker = createTracker({
  siteId: 'your-site-id',
  endpoint: '/ingest/track',
  batchInterval: 3000,
  debug: true,
});

tracker.trackPageView();
tracker.track('custom_event', { key: 'value' });
tracker.flush();
```

## Configuration

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `siteId` | `string` | - | Your site identifier |
| `endpoint` | `string` | - | Tracking endpoint path (e.g., `/ingest/track`) |
| `apiUrl` | `string` | - | *(Deprecated)* Base URL for direct API access |
| `batchInterval` | `number` | `5000` | Batch flush interval in ms |
| `debug` | `boolean` | `false` | Enable console debug logging |

## Privacy

- No cookies used -- only `localStorage` and `sessionStorage`
- IP addresses are hashed server-side (SHA-256), never stored raw
- Anonymous IDs are random UUIDs, not fingerprints
- Session expires after 30 minutes of inactivity
- No PII is collected

## Build

```bash
npm run build
```
