# @acr/tracker

Lightweight first-party analytics tracker for ACR Next.js App Router sites.

## Installation

```bash
npm install @acr/tracker
```

## Usage

### Next.js App Router

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
          apiUrl="https://analytics.example.com"
          debug={process.env.NODE_ENV === 'development'}
        />
      </body>
    </html>
  );
}
```

This automatically tracks:

- **Page views** on every route change
- **Scroll depth** at 25%, 50%, 75%, and 100% thresholds
- **Core Web Vitals** (CLS, INP, LCP, FCP, TTFB)

### Custom Events

```tsx
import { track } from '@acr/tracker';

// Track a custom event
track('button_click', { button_id: 'cta-hero', variant: 'blue' });

// Track a form submission
track('form_submit', { form_name: 'contact', success: true });
```

### Programmatic Tracker

```tsx
import { createTracker } from '@acr/tracker';

const tracker = createTracker({
  siteId: 'your-site-id',
  apiUrl: 'https://analytics.example.com',
  batchInterval: 3000, // flush every 3 seconds
  debug: true,
});

tracker.trackPageView();
tracker.track('custom_event', { key: 'value' });
tracker.flush(); // force immediate flush
```

## Configuration

| Prop            | Type      | Default | Description                     |
| --------------- | --------- | ------- | ------------------------------- |
| `siteId`        | `string`  | -       | Your site identifier            |
| `apiUrl`        | `string`  | -       | Analytics API base URL          |
| `batchInterval` | `number`  | `5000`  | Batch flush interval in ms      |
| `debug`         | `boolean` | `false` | Enable console debug logging    |

## Build

```bash
npm run build
```
