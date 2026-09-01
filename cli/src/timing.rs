//! Every wait, poll, and debounce the control plane relies on, in one place.

use std::time::Duration;

/// How long to wait for Hyprland to stop listing / mapping the plugin after
/// `plugin unload`. PLUGIN_EXIT + dlclose is synchronous, but a just-issued
/// hyprctl unload may still be in the compositor event loop.
pub const UNLOAD_TIMEOUT: Duration = Duration::from_secs(8);

/// Poll interval while waiting for the plugin to go away.
pub const UNLOAD_POLL: Duration = Duration::from_millis(100);

/// `omarchy plugin add` discovery poll (the shell rescans asynchronously).
pub const DISCOVERY_POLL: Duration = Duration::from_millis(50);
pub const DISCOVERY_ATTEMPTS: u32 = 40;

/// Number of polls in `timeout`, at least one.
pub fn poll_steps(timeout: Duration, poll: Duration) -> u32 {
    let steps = timeout.as_millis() / poll.as_millis().max(1);
    (steps as u32).max(1)
}

/// Repeat `done()` every `poll` until it is true or `timeout` elapses.
pub fn wait_until(timeout: Duration, poll: Duration, mut done: impl FnMut() -> bool) -> bool {
    for _ in 0..poll_steps(timeout, poll) {
        if done() {
            return true;
        }
        std::thread::sleep(poll);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps() {
        assert_eq!(poll_steps(UNLOAD_TIMEOUT, UNLOAD_POLL), 80);
        assert_eq!(poll_steps(Duration::from_millis(300), UNLOAD_POLL), 3);
        assert_eq!(poll_steps(Duration::from_millis(1), UNLOAD_POLL), 1);
    }

    #[test]
    fn wait_until_returns_early() {
        let mut n = 0;
        let ok = wait_until(Duration::from_millis(500), Duration::from_millis(1), || {
            n += 1;
            n >= 3
        });
        assert!(ok);
        assert_eq!(n, 3);
        assert!(!wait_until(Duration::from_millis(3), Duration::from_millis(1), || false));
    }
}
