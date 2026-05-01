# ACR Tracker — WordPress Installation Guide

Complete step-by-step guide for installing the ACR first-party analytics tracker on a WordPress site (stealthagents.com).

---

## Prerequisites

- FTP/SSH access to the WordPress hosting
- Ability to edit `wp-config.php`
- WordPress admin access (for WP Rocket exclusion)

---

## Step 1: Edit wp-config.php

Connect to the server via FTP/SSH and open `wp-config.php` (in the WordPress root directory).

Add these two lines **before** the line that says `/* That's all, stop editing! */`:

```php
define('ACR_SITE_ID', 'stealth-agents');
define('ACR_TRACKING_API_URL', 'https://acrtracking.duckdns.org/api/track');
```

Save the file.

---

## Step 2: Create the mu-plugins Directory (if it doesn't exist)

Check if `wp-content/mu-plugins/` exists. If not, create it:

```bash
# Via SSH:
mkdir -p /path/to/wordpress/wp-content/mu-plugins/
```

Or create the `mu-plugins` folder via FTP inside `wp-content/`.

> **What are mu-plugins?** "Must-use plugins" that WordPress auto-loads on every page. No activation needed. They can't be deactivated from the admin panel, which makes them ideal for critical tracking code.

---

## Step 3: Upload the Tracker Files

Download these two files from the GitHub repo:

1. **Proxy plugin**: [acr-tracker-proxy.php](https://github.com/coolifystealthagents/acr-tracker/blob/main/wordpress/acr-tracker-proxy.php)
2. **Tracker script**: [acr-tracker.wp.js](https://github.com/coolifystealthagents/acr-tracker/blob/main/dist/acr-tracker.wp.js)

Upload both to `wp-content/mu-plugins/`:

```
wp-content/
  mu-plugins/
    acr-tracker-proxy.php    <-- PHP proxy + script loader
    acr-tracker.wp.js        <-- Vanilla JS tracker
```

> **Important**: Both files must be in the same directory (`mu-plugins/`). The PHP file references the JS file using `plugin_dir_url(__FILE__)`.

---

## Step 4: Exclude from WP Rocket DJE (Delay JavaScript Execution)

WP Rocket's "Delay JavaScript Execution" feature delays scripts until the first user interaction (click, scroll, keypress). Our tracker must fire immediately on page load to capture the initial pageview.

1. Go to **WP Admin > Settings > WP Rocket**
2. Click the **File Optimization** tab
3. Scroll to **Delay JavaScript execution**
4. In the exclusion textarea, add:
   ```
   acr-tracker
   ```
5. Click **Save Changes**

This tells WP Rocket to not delay our tracker script.

---

## Step 5: Verify Installation

### Quick Check (30 seconds)

1. Open **stealthagents.com** in a new incognito/private window
2. Open **DevTools** (F12 or Cmd+Option+I)
3. Go to the **Network** tab
4. Filter by typing `ingest`
5. Refresh the page

**Expected**: You should see a POST request to `/wp-json/acr-tracker/v1/ingest` with:
- Status: `200`
- Response: `{"status":"ok","accepted":1}`

### Console Check

1. In DevTools, go to the **Console** tab
2. Type: `window.acrTracker`
3. Press Enter

**Expected**: Should show an object with methods: `track`, `trackPageView`, `trackScrollDepth`, `trackCWV`, `trackLead`, `checkFunnelStep`, `flush`, `destroy`

If you see `undefined`, the script didn't load — check troubleshooting below.

### Debug Mode

To enable verbose logging, temporarily add `debug: true` to the config. In DevTools Console:

```javascript
// Check if config is loaded
console.log(window.ACR_TRACKER_CONFIG);
```

The config should show `siteId: "stealth-agents"` and the endpoint URL.

### Dashboard Check

1. Open the ACR Dashboard (localhost:8000)
2. Check the site filter dropdown — "Stealth Agents" should appear
3. Go to Realtime > Events Feed — you should see your pageview

---

## Step 6: Test Form Submission (WPForms)

1. Navigate to a page with a contact form (e.g., `/contact-us/`)
2. Open DevTools > Network tab, filter by `ingest`
3. Fill out and submit the form
4. **Expected events in Network tab**:
   - `form_view` — fired when the form first appeared on the page
   - `form_submit` — fired when the form was submitted (via WPForms AJAX detection)
   - `lead_submit` — fired if contact fields (name/email/phone) were detected
5. All three should return `{"status":"ok","accepted":1}`

### Test Funnel Detection

Visit these pages in order and check the Network tab for funnel events:

| Page | Expected Event |
|------|---------------|
| `/contact-us/` | `funnel_form_page` |
| `/thank-you/` | `funnel_form_submitted` |
| `/thanks-whats-next/` | `funnel_booking_confirmed` |

> Note: The tracker handles both `/contact-us` and `/contact-us/` (trailing slashes normalized).

---

## Troubleshooting

### Problem: No `ingest` requests in Network tab

**Check 1: mu-plugin loaded?**
- Go to WP Admin > Plugins > look for "Must-Use" tab at the top
- "ACR Tracker Proxy" should be listed there
- If not: verify the file is named exactly `acr-tracker-proxy.php` and is in `wp-content/mu-plugins/`

**Check 2: JS file accessible?**
- In browser, navigate to: `https://stealthagents.com/wp-content/mu-plugins/acr-tracker.wp.js`
- You should see the JavaScript source code
- If 403/404: check file permissions (should be 644) and file name

**Check 3: Script in page source?**
- View page source (Ctrl+U)
- Search for `acr-tracker`
- You should find a `<script>` tag loading `acr-tracker.wp.js` and an inline script setting `window.ACR_TRACKER_CONFIG`
- If missing: check that `acr-tracker-proxy.php` is valid PHP (no syntax errors)

**Check 4: WP Rocket DJE blocking?**
- If the script tag is in the source but no Network requests fire until you click/scroll, WP Rocket DJE is delaying it
- Follow Step 4 above to add the exclusion
- Clear WP Rocket cache after adding the exclusion

### Problem: `ingest` request returns 404

- The WordPress REST API might be disabled or blocked
- Check: visit `https://stealthagents.com/wp-json/` in browser — should return JSON
- If 404: your permalink settings may need to be refreshed
  - Go to WP Admin > Settings > Permalinks > click "Save Changes" (without changing anything)
  - This flushes rewrite rules

### Problem: `ingest` request returns 502 or timeout

- The proxy can't reach the tracking API
- Check that `ACR_TRACKING_API_URL` in `wp-config.php` is correct: `https://acrtracking.duckdns.org/api/track`
- Test from server: `curl -s https://acrtracking.duckdns.org/api/health` — should return `{"status":"ok","clickhouse":"connected"}`
- If the hosting blocks outbound HTTPS: contact hosting provider to whitelist `acrtracking.duckdns.org`

### Problem: `ingest` returns `{"detail":"Invalid site_id"}`

- The site ID doesn't match the tracking API's allowed list
- Verify `ACR_SITE_ID` in `wp-config.php` is exactly `stealth-agents` (no spaces, no quotes issues)

### Problem: WPForms submissions not tracked

- WPForms AJAX must be enabled (default in modern WPForms)
- Check Console for `[acr-tracker] WPForms submission tracked` (with debug mode)
- If using WPForms Lite: confirm AJAX submission is supported in your version
- The tracker detects WPForms via jQuery event `wpformsAjaxSubmitSuccess` — jQuery must be loaded before our script (WordPress loads jQuery by default)

### Problem: Events tracked but not showing in dashboard

- Events may take a few seconds to appear (batch interval is 5s)
- Check the dashboard site filter — select "Stealth Agents" or "All Sites"
- If still not showing: check ClickHouse directly or the Realtime > Events Feed endpoint

### Problem: GeoIP shows wrong location

- This should NOT happen with the WordPress setup — the PHP proxy forwards the visitor's real IP via `X-Forwarded-For`
- If it does: check that Cloudflare is providing `CF-Connecting-IP` header (enabled by default)

---

## What Gets Tracked Automatically

| Event | Trigger | Data Captured |
|-------|---------|---------------|
| `pageview` | Every page load | URL, title, referrer, UTM params, landing page |
| `scroll_depth` | 25%, 50%, 75%, 100% | Scroll percentage |
| `form_view` | Form appears on page | Form ID, name, action, field count, visibility |
| `form_submit` | Native form submit + WPForms AJAX | Form metadata + CTA attribution |
| `lead_submit` | Form with name/email/phone detected | Contact fields extracted |
| `cta_click` | Button/link with CTA text patterns | Text, tag, classes, href, position |
| `outbound_click` | External link clicked | URL, text, domain |
| `download_click` | File link (.pdf, .zip, etc.) | File URL |
| `mailto_click` | mailto: link clicked | Email address |
| `tel_click` | tel: link clicked | Phone number |
| `cwv` | Core Web Vitals measured | LCP, FCP, CLS, INP, TTFB |
| `js_error` | JavaScript error | Message, source, line, column |
| `funnel_form_page` | Visit /contact-us/ | Funnel step 1 |
| `funnel_form_submitted` | Visit /thank-you/ | Funnel step 2 |
| `funnel_booking_confirmed` | Visit /thanks-whats-next/ | Funnel step 3 |

All events include: session ID, anonymous visitor ID, device context, engagement time, screen size, timezone.

---

## Architecture

```
Browser (stealthagents.com)
    |
    | POST /wp-json/acr-tracker/v1/ingest (same-domain, ad-blocker resistant)
    v
WordPress mu-plugin (acr-tracker-proxy.php)
    |
    | Forwards with X-Forwarded-For (visitor's real IP via CF-Connecting-IP)
    v
Tracking API (acrtracking.duckdns.org)
    |
    | Bot filtering, event normalization, GeoIP lookup
    v
ClickHouse (acr_analytics database)
    |
    v
ACR Dashboard (localhost:8000)
```

---

## Uninstalling

To remove the tracker:

1. Delete `wp-content/mu-plugins/acr-tracker-proxy.php`
2. Delete `wp-content/mu-plugins/acr-tracker.wp.js`
3. Remove the two `define()` lines from `wp-config.php`
4. Remove the WP Rocket DJE exclusion

No database changes, no settings to clean up — the tracker is fully self-contained.
