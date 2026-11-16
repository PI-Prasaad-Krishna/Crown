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
