<?php
/**
 * Plugin Name: ACR Tracker Proxy
 * Description: First-party proxy for ACR analytics tracking. Forwards events to the tracking API.
 * Version: 1.0.0
 * Author: ACR Data Analytics
 *
 * INSTALLATION:
 *   1. Copy this file to wp-content/mu-plugins/acr-tracker-proxy.php
 *   2. Copy acr-tracker.wp.js to wp-content/mu-plugins/acr-tracker.wp.js
 *   3. Done — the plugin auto-activates (mu-plugins don't need activation)
 *
 * CONFIGURATION:
 *   Set ACR_TRACKING_API_URL in wp-config.php:
 *     define('ACR_TRACKING_API_URL', 'https://acrtracking.duckdns.org/api/track');
 *
 *   Set ACR_SITE_ID in wp-config.php:
 *     define('ACR_SITE_ID', 'stealth-agents');
 */

if (!defined('ABSPATH')) exit;

// Default tracking API URL
if (!defined('ACR_TRACKING_API_URL')) {
    define('ACR_TRACKING_API_URL', 'https://acrtracking.duckdns.org/api/track');
}

if (!defined('ACR_SITE_ID')) {
    define('ACR_SITE_ID', 'stealth-agents');
}

/**
 * Register REST API proxy endpoint.
 * POST /wp-json/acr-tracker/v1/ingest
 */
add_action('rest_api_init', function () {
    register_rest_route('acr-tracker/v1', '/ingest', [
        'methods'  => 'POST',
        'callback' => 'acr_tracker_proxy_handler',
        'permission_callback' => '__return_true', // Public endpoint
    ]);
});

/**
 * Proxy handler — forwards the tracking payload to the upstream API
 * and passes along the visitor's real IP for GeoIP.
 */
function acr_tracker_proxy_handler(WP_REST_Request $request) {
    $body = $request->get_body();

    // Get the visitor's real IP (works behind Cloudflare, proxies, etc.)
    $visitor_ip = '';
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $visitor_ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
    } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        // Take the first IP in the chain (original client)
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $visitor_ip = trim($parts[0]);
    } elseif (!empty($_SERVER['HTTP_X_REAL_IP'])) {
        $visitor_ip = $_SERVER['HTTP_X_REAL_IP'];
    } elseif (!empty($_SERVER['REMOTE_ADDR'])) {
        $visitor_ip = $_SERVER['REMOTE_ADDR'];
    }

    // Forward the request to the tracking API
    $response = wp_remote_post(ACR_TRACKING_API_URL, [
        'body'    => $body,
        'headers' => [
            'Content-Type'    => 'application/json',
            'X-Forwarded-For' => $visitor_ip,
            'User-Agent'      => isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '',
            'Accept-Language' => isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? $_SERVER['HTTP_ACCEPT_LANGUAGE'] : '',
            'Referer'         => isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : '',
        ],
        'timeout' => 5,
        'sslverify' => true,
    ]);

    if (is_wp_error($response)) {
        return new WP_REST_Response([
            'status' => 'error',
            'message' => $response->get_error_message(),
        ], 502);
    }

    $status_code = wp_remote_retrieve_response_code($response);
    $resp_body = wp_remote_retrieve_body($response);

    return new WP_REST_Response(
        json_decode($resp_body, true) ?: ['status' => 'ok'],
        $status_code
    );
}

/**
 * Enqueue the tracker script on all frontend pages.
 */
add_action('wp_enqueue_scripts', function () {
    // Register the script
    wp_enqueue_script(
        'acr-tracker',
        plugin_dir_url(__FILE__) . 'acr-tracker.wp.js',
        [],      // No dependencies
        '0.3.0', // Version
        true     // Load in footer (defer)
    );

    // Pass config to the script
    wp_add_inline_script('acr-tracker', sprintf(
        'window.ACR_TRACKER_CONFIG = %s;',
        json_encode([
            'siteId'   => ACR_SITE_ID,
            'endpoint' => rest_url('acr-tracker/v1/ingest'),
            'debug'    => defined('WP_DEBUG') && WP_DEBUG,
        ])
    ), 'before');
});

/**
 * Add CORS headers to our REST endpoint (needed if tracker sends from different origin).
 */
add_action('rest_api_init', function () {
    remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');
    add_filter('rest_pre_serve_request', function ($value) {
        $origin = get_http_origin();
        if ($origin) {
            header('Access-Control-Allow-Origin: ' . esc_url_raw($origin));
        } else {
            header('Access-Control-Allow-Origin: *');
        }
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        return $value;
    });
}, 15);
