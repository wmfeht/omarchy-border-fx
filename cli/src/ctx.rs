//! Everything a flow needs from the outside world, injected so flows are unit
//! testable without a compositor, a compiler, or a notification daemon.

use std::process::{Command, Stdio};

use crate::hyprctl::Hyprctl;
use crate::paths::{self, Paths};

pub struct Ctx<'a> {
    pub paths: &'a Paths,
    pub hc: &'a dyn Hyprctl,
    /// User-facing notification (desktop toast). Also logged to stderr by the flow.
    pub notify: &'a dyn Fn(&str),
    /// Build `hypr-shiny-border.so` into `paths.build_dir`. True on success.
    pub build: &'a dyn Fn(&Paths) -> bool,
}

/// `omarchy-notification-send` if present, else `notify-send`. Never fails.
pub fn desktop_notify(plugin_id: &str, msg: &str) {
    let quiet = |mut c: Command| {
        let _ = c.stdout(Stdio::null()).stderr(Stdio::null()).status();
    };
    if paths::which("omarchy-notification-send").is_some() {
        let mut c = Command::new("omarchy-notification-send");
        c.args(["--app-name", plugin_id, "-u", "normal", "Border FX", msg]);
        quiet(c);
    } else if paths::which("notify-send").is_some() {
        let mut c = Command::new("notify-send");
        c.args(["-a", plugin_id, "Border FX", msg]);
        quiet(c);
    }
}

/// `make -C <hypr_src> all BUILD_DIR=<build_dir>` with all output on stderr.
pub fn make_plugin(p: &Paths) -> bool {
    let build_dir = p.build_dir.to_string_lossy().into_owned();
    Command::new("make")
        .arg("-C")
        .arg(&p.hypr_src)
        .arg("all")
        .arg(format!("BUILD_DIR={build_dir}"))
        .stdout(Stdio::from(std::io::stderr()))
        .stderr(Stdio::inherit())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Run a program, returning stdout on success. `None` when it is missing or fails.
pub fn capture(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Run a program inheriting stdio; true on exit 0.
pub fn run(program: &str, args: &[&str]) -> bool {
    Command::new(program).args(args).status().map(|s| s.success()).unwrap_or(false)
}

/// Like [`run`] but discards output.
pub fn run_quiet(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
