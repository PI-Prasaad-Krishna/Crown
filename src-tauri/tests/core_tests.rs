use crown_lib::*;

#[test]
fn tracker_requests_are_blocked_when_enabled() {
    let cfg = ShieldRuntimeConfig::default();
    let hit = evaluate_resource_request(
        &cfg,
        "example.com",
        "https://www.google-analytics.com/analytics.js",
    );
    assert_eq!(hit.map(|(k, _)| k), Some("tracker"));
    let hit = evaluate_resource_request(
        &cfg,
        "example.com",
        "https://static.hotjar.com/c/hotjar-1.js",
    );
    assert_eq!(hit.map(|(k, _)| k), Some("tracker"));
}

#[test]
fn tracker_requests_pass_when_tracker_blocking_off_or_shields_off() {
    let mut cfg = ShieldRuntimeConfig::default();
    cfg.block_trackers = false;
    assert!(evaluate_resource_request(
        &cfg,
        "example.com",
        "https://www.google-analytics.com/analytics.js"
    )
    .is_none());
    let mut cfg = ShieldRuntimeConfig::default();
    cfg.shields_enabled = false;
    assert!(evaluate_resource_request(
        &cfg,
        "example.com",
        "https://www.google-analytics.com/analytics.js"
    )
    .is_none());
}

#[test]
fn benign_requests_are_not_blocked() {
    let cfg = ShieldRuntimeConfig::default();
    assert!(
        evaluate_resource_request(&cfg, "example.com", "https://cdn.example.com/app.js").is_none()
    );
}

#[test]
fn ad_requests_are_blocked() {
    let cfg = ShieldRuntimeConfig::default();
    let hit = evaluate_resource_request(
        &cfg,
        "example.com",
        "https://securepubads.doubleclick.net/x.js",
    );
    assert_eq!(hit.map(|(k, _)| k), Some("ad"));
}

#[cfg(desktop)]
#[test]
fn popup_requires_recent_gesture() {
    let g = PopupGuard::default();
    assert_eq!(g.check(10_000), PopupVerdict::NoGesture);
    g.mark_gesture(10_000);
    assert_eq!(g.check(11_000), PopupVerdict::Allow);
    let g2 = PopupGuard::default();
    g2.mark_gesture(1_000);
    assert_eq!(
        g2.check(1_000 + POPUP_GESTURE_WINDOW_MS + 1),
        PopupVerdict::NoGesture
    );
}

#[cfg(desktop)]
#[test]
fn popup_rate_limit_and_burst_cap() {
    let g = PopupGuard::default();
    g.mark_gesture(5_000);
    assert_eq!(g.check(5_100), PopupVerdict::Allow);
    g.mark_gesture(5_200);
    assert_eq!(g.check(5_300), PopupVerdict::RateLimited);
    g.mark_gesture(7_200);
    assert_eq!(g.check(7_300), PopupVerdict::Allow);
    g.mark_gesture(9_400);
    assert_eq!(g.check(9_500), PopupVerdict::Allow);
    g.mark_gesture(11_700);
    assert_eq!(g.check(11_800), PopupVerdict::RateLimited);
    g.reset_page();
    assert_eq!(g.check(11_900), PopupVerdict::Allow);
}

#[cfg(desktop)]
#[test]
fn popup_allow_once_permit_is_single_use() {
    let g = PopupGuard::default();
    g.grant_permit(1_000);
    assert_eq!(g.check(2_000), PopupVerdict::Allow);
    assert_eq!(g.check(2_100), PopupVerdict::NoGesture);
}

#[cfg(desktop)]
#[test]
fn popup_clear_gesture_invalidates_prior_gesture() {
    let g = PopupGuard::default();
    g.mark_gesture(10_000);
    assert_eq!(g.check(10_500), PopupVerdict::Allow);
    g.mark_gesture(13_000);
    g.clear_gesture();
    assert_eq!(g.check(13_100), PopupVerdict::NoGesture);
}

#[test]
fn update_percent_handles_known_unknown_and_overflow() {
    assert_eq!(compute_update_percent(0, Some(100)), 0);
    assert_eq!(compute_update_percent(50, Some(200)), 25);
    assert_eq!(compute_update_percent(250, Some(200)), 100);
    assert_eq!(compute_update_percent(1024, None), 0);
    assert_eq!(compute_update_percent(1024, Some(0)), 0);
}

#[test]
fn shield_mock_responses_provide_valid_js_shims() {
    let (body, headers) = shield_mock_response_for_url(
        "https://static.doubleclick.net/instream/ad_status.js",
        true,
    );
    assert_eq!(std::str::from_utf8(body).unwrap(), "window.google_ad_status = 1;\n");
    assert!(headers.contains("application/javascript"));

    let (body, headers) = shield_mock_response_for_url(
        "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-123",
        true,
    );
    let body_str = std::str::from_utf8(body).unwrap();
    assert!(body_str.contains("self.adsbygoogle"));
    assert!(headers.contains("application/javascript"));

    let (body, headers) =
        shield_mock_response_for_url("https://www.youtube.com/pagead/conversion_async.js", true);
    assert_eq!(std::str::from_utf8(body).unwrap(), "/* blocked */\n");
    assert!(headers.contains("application/javascript"));

    let (body, headers) =
        shield_mock_response_for_url("https://www.youtube.com/api/stats/ads?v=123", false);
    assert!(body.is_empty());
    assert!(headers.contains("text/plain"));
}

#[test]
fn ssrf_blocks_trailing_dot_ipv6_tunnels_and_dangerous_ports() {
    assert!(is_restricted_network_host("localhost."));
    assert!(is_restricted_network_host("LOCALHOST."));
    assert!(is_restricted_network_host("router.home.arpa."));
    assert!(is_restricted_network_host("internal.svc.local"));
    assert!(is_restricted_network_host("0.1.2.3"));
    assert!(is_restricted_network_host("198.18.0.5"));
    assert!(is_restricted_network_host("[::ffff:127.0.0.1]"));
    assert!(is_restricted_network_host("[64:ff9b::127.0.0.1]"));
    assert!(is_restricted_network_host("[2002:7f00:1::1]"));
    assert!(is_restricted_network_host("[fe80::1%25eth0]"));
    assert!(!is_restricted_network_host("example.com"));
    assert!(!is_restricted_network_host("93.184.216.34"));

    assert!(is_unsafe_network_port(25));
    assert!(is_unsafe_network_port(445));
    assert!(is_unsafe_network_port(1080));
    assert!(is_unsafe_network_port(2375));
    assert!(is_unsafe_network_port(6379));
    assert!(is_unsafe_network_port(9222));
    assert!(!is_unsafe_network_port(80));
    assert!(!is_unsafe_network_port(443));
}

#[test]
fn bridge_secret_verification_rejects_forged_messages() {
    let secret = generate_bridge_secret();
    assert_eq!(secret.len(), 32);
    let valid = format!("{}:crown:gesture", secret);
    assert_eq!(verify_bridge_message(&secret, &valid), Some("crown:gesture"));
    assert_eq!(verify_bridge_message(&secret, "crown:gesture"), None);
    assert_eq!(verify_bridge_message(&secret, "0000:crown:gesture"), None);
    assert_eq!(verify_bridge_message("", &valid), None);
}

#[test]
fn shield_injection_neutralizes_html_breakout_and_js_quote_breakout() {
    let injected = build_shield_injection(
        "https://example.com/';alert(1);//",
        true,
        "body{color:red} </STYLE><img src=x onerror=alert(1)>",
        "console.log(1)</ScRiPt><script>alert(2)</script><!--",
        "t\";alert(3)//",
    );
    let lower = injected.to_ascii_lowercase();
    assert!(!lower.contains("</style><img"));
    assert!(!lower.contains("</script><script>alert(2)"));
    assert!(!injected.contains("';alert(1);//'"));
    assert!(injected.contains("let virtualCurrentUrl = \"https://example.com/';alert(1);//\";"));
    assert!(injected.contains("const CROWN_TAB_ID = \"t\\\";alert(3)//\";"));
    assert!(!injected.contains("const CROWN_TAB_ID = \"t\";alert(3)//\";"));
}

#[test]
fn cookie_prefix_invariants_enforce_https_path_and_domain_rules() {
    let tmp = std::env::temp_dir().join(format!(
        "crown_cookie_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let jar = crown_lib::cookie_jar::SystemCookieJar::new(&tmp);
    jar.add_whitelist_domain("example.com");

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::SET_COOKIE,
        "__Host-sess=abc; Secure; Path=/".parse().unwrap(),
    );
    // Non-HTTPS must NOT commit __Host- or Secure cookies
    parse_and_commit_cookies(&headers, "example.com", false, &jar);
    assert!(jar.get_cookies_for_domain("example.com").is_empty());

    // __Host- with Domain attribute or non-root Path on HTTPS must be rejected
    let mut bad_host = reqwest::header::HeaderMap::new();
    bad_host.append(
        reqwest::header::SET_COOKIE,
        "__Host-a=1; Secure; Path=/; Domain=example.com".parse().unwrap(),
    );
    bad_host.append(
        reqwest::header::SET_COOKIE,
        "__Host-b=2; Secure; Path=/admin".parse().unwrap(),
    );
    bad_host.append(
        reqwest::header::SET_COOKIE,
        "__Secure-c=3; Path=/".parse().unwrap(),
    );
    parse_and_commit_cookies(&bad_host, "example.com", true, &jar);
    assert!(jar.get_cookies_for_domain("example.com").is_empty());

    // Valid __Host- cookie over HTTPS commits cleanly
    parse_and_commit_cookies(&headers, "example.com", true, &jar);
    assert_eq!(jar.get_cookies_for_domain("example.com").len(), 1);

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn profile_id_sanitization_rejects_traversal_and_invalid_chars() {
    assert_eq!(sanitize_profile_id(None).unwrap(), "default");
    assert_eq!(sanitize_profile_id(Some("")).unwrap(), "default");
    assert_eq!(sanitize_profile_id(Some("default")).unwrap(), "default");
    assert_eq!(
        sanitize_profile_id(Some("profile-1731900_work")).unwrap(),
        "profile-1731900_work"
    );

    assert!(sanitize_profile_id(Some("..")).is_err());
    assert!(sanitize_profile_id(Some("../escape")).is_err());
    assert!(sanitize_profile_id(Some("a/b")).is_err());
    assert!(sanitize_profile_id(Some("a\\b")).is_err());
    assert!(sanitize_profile_id(Some("work:prod")).is_err());
    assert!(sanitize_profile_id(Some("work space")).is_err());
    assert!(sanitize_profile_id(Some(&"a".repeat(65))).is_err());
}

#[test]
fn profile_webview_labels_isolate_identical_tab_ids_across_profiles() {
    let l1 = sanitize_profile_webview_label("main", "default", "tab-1");
    let l2 = sanitize_profile_webview_label("main", "profile-work", "tab-1");
    let l3 = sanitize_profile_webview_label("main", "incognito", "tab-1");
    assert_ne!(l1, l2);
    assert_ne!(l1, l3);
    assert_ne!(l2, l3);
}

#[test]
fn vault_entries_are_strictly_isolated_across_profiles() {
    let tmp = std::env::temp_dir().join(format!(
        "crown_vault_prof_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let vault = crown_lib::crypto_vault::SystemVault::new(&tmp);

    vault
        .save_entry_for_profile(
            Some("default"),
            crown_lib::crypto_vault::VaultCredential {
                id: "c1".to_string(),
                origin: "https://personal.example".to_string(),
                username: "personal".to_string(),
                secret: "p-secret".to_string(),
                created_at: 1,
            },
        )
        .unwrap();

    vault
        .save_entry_for_profile(
            Some("profile-work"),
            crown_lib::crypto_vault::VaultCredential {
                id: "c2".to_string(),
                origin: "https://work.example".to_string(),
                username: "work".to_string(),
                secret: "w-secret".to_string(),
                created_at: 2,
            },
        )
        .unwrap();

    let default_entries = vault.get_entries_for_profile(Some("default")).unwrap();
    let work_entries = vault.get_entries_for_profile(Some("profile-work")).unwrap();
    let other_entries = vault.get_entries_for_profile(Some("profile-guest")).unwrap();

    assert_eq!(default_entries.len(), 1);
    assert_eq!(default_entries[0].username, "personal");
    assert_eq!(work_entries.len(), 1);
    assert_eq!(work_entries[0].username, "work");
    assert!(other_entries.is_empty());

    assert!(vault.delete_profile_vault("default").is_err());
    vault.delete_profile_vault("profile-work").unwrap();
    assert!(vault.get_entries_for_profile(Some("profile-work")).unwrap().is_empty());

    let _ = std::fs::remove_dir_all(&tmp);
}
