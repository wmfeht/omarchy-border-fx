use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use serde_json::{Value, json};

use border_fx::apply::{self, ApplyOpts};
use border_fx::ctx::{self, Ctx};
use border_fx::hyprctl::{self, Hyprctl};
use border_fx::look;
use border_fx::paths::Paths;
use border_fx::{abi, ensure, json as lookjson, protocol, session, shell_json, teardown, theme};

/// Control plane for the wmfeht.border-fx Omarchy plugin.
///
/// Resolves the shared look from shell.json, fans it out to the Hyprland
/// window ring and the shell chrome, and builds / loads / unloads the
/// compositor plugin. User-level only; never sudo.
#[derive(Parser)]
#[command(name = "border-fx", version, about, long_about = None)]
struct Cli {
    /// Clone root of the plugin (default: $BORDER_FX_ROOT, else the current directory).
    #[arg(long, global = true, value_name = "DIR")]
    root: Option<PathBuf>,

    /// Hyprland instance to talk to (default: $SHINY_INSTANCE, else 0).
    #[arg(long, global = true, value_name = "N")]
    instance: Option<String>,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args, Clone, Default)]
struct LookArgs {
    /// The plugins[] entry as JSON. Default: $LOOK_JSON, else the entry in shell.json.
    #[arg(long, value_name = "JSON")]
    look_json: Option<String>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Build / install / load the window ring and persist the look (called after enable).
    ///
    /// Prints LOOK=<resolved json> and STATUS=ok|reuse|hyprpm|load-failed|build-failed|skipped|no-hyprctl.
    Ensure(LookArgs),

    /// Resolve the look, write ~/.config/hypr/border-fx.lua, optionally eval it.
    Apply {
        #[command(flatten)]
        look: LookArgs,
        /// hyprctl eval dofile() of the lua, only if the window plugin is loaded.
        #[arg(long)]
        eval: bool,
        /// enabled = false and skip hl.plugin.load (the Omarchy plugin is off).
        #[arg(long)]
        disabled: bool,
        /// Skip hl.plugin.load even when enabled.
        #[arg(long)]
        no_load: bool,
        /// Print the lua instead of writing it.
        #[arg(long)]
        stdout: bool,
        /// Write the lua here instead of $LUA_FILE / ~/.config/hypr/border-fx.lua.
        #[arg(long, value_name = "PATH")]
        lua: Option<PathBuf>,
    },

    /// Print the resolved look as JSON (theme preset, nested overlay, coerced, clamped).
    Look {
        #[command(flatten)]
        look: LookArgs,
        #[arg(long)]
        pretty: bool,
    },

    /// Unload the Omarchy-owned session copy and persist a disabled lua (called on disable).
    Teardown {
        #[command(flatten)]
        look: LookArgs,
        /// Also delete the session .so and the generated lua.
        #[arg(long)]
        purge: bool,
    },

    /// Diagnostics: paths, compositor state, ABI identity.
    Status,

    /// Current Omarchy theme (name, directory, colors.toml).
    Theme,

    /// Snapshot / restore this plugin's plugins[] look in shell.json.
    ShellLook {
        #[command(subcommand)]
        cmd: ShellLookCmd,
    },
}

#[derive(Subcommand)]
enum ShellLookCmd {
    /// Print the entry as compact JSON (nothing if absent).
    Snapshot,
    /// Merge a saved entry back onto plugins[] (rewrites id, drops legacy ids).
    Restore {
        /// Saved entry JSON; empty / null / {} is a no-op.
        json: String,
    },
}

fn load_entry(p: &Paths, args: &LookArgs, fallback_shell_json: bool) -> Result<Value, String> {
    if let Some(j) = &args.look_json {
        return lookjson::parse_look(j);
    }
    if let Ok(j) = std::env::var("LOOK_JSON")
        && !j.is_empty()
    {
        return lookjson::parse_look(&j);
    }
    if fallback_shell_json && p.shell_json.is_file() {
        let text = std::fs::read_to_string(&p.shell_json).map_err(|e| e.to_string())?;
        let cfg: Value = serde_json::from_str(&text).map_err(|e| format!("shell.json: {e}"))?;
        return Ok(look::entry_from_shell_config(&cfg, &p.plugin_ids()));
    }
    Ok(Value::Object(Default::default()))
}

fn print_look(look: &look::Look) {
    println!("{}", protocol::look_line(&Value::Object(look.clone())));
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut paths = Paths::from_env(&cwd);
    if let Some(root) = cli.root {
        paths.hypr_src = if std::env::var_os("HYPR_SRC").is_some() { paths.hypr_src } else { root.join("hypr") };
        paths.plugin_root = root;
    }
    if let Some(i) = cli.instance {
        paths.hyprctl_instance = i;
    }
    match run(cli.cmd, paths) {
        Ok(code) => code,
        Err(msg) => {
            eprintln!("border-fx: {msg}");
            ExitCode::from(2)
        }
    }
}

fn run(cmd: Cmd, mut paths: Paths) -> Result<ExitCode, String> {
    let hc = hyprctl::Cli::new(&paths.hyprctl_instance);
    let plugin_id = paths.plugin_id.clone();
    let notify = move |msg: &str| ctx::desktop_notify(&plugin_id, msg);
    let build = ctx::make_plugin;
    let base = theme::look_base(&paths);

    match cmd {
        Cmd::Ensure(args) => {
            let entry = load_entry(&paths, &args, true)?;
            let ctx = Ctx { paths: &paths, hc: &hc, notify: &notify, build: &build };
            let out = ensure::run(&ctx, &entry, &base);
            print_look(&out.look);
            println!("{}", protocol::status_line(out.status.as_str()));
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Apply { look: args, eval, disabled, no_load, stdout, lua } => {
            let entry = load_entry(&paths, &args, true)?;
            if let Some(l) = lua {
                paths.lua_file = l;
            }
            let ctx = Ctx { paths: &paths, hc: &hc, notify: &notify, build: &build };
            let o = ApplyOpts { eval, disabled, no_load };
            if stdout {
                let (_, warnings, text) = apply::render(&ctx, &entry, &base, o);
                for w in &warnings.0 {
                    eprintln!("{w}");
                }
                print!("{text}");
                return Ok(ExitCode::SUCCESS);
            }
            let a = apply::run(&ctx, &entry, &base, o)
                .map_err(|e| format!("could not write {}: {e}", paths.lua_file.display()))?;
            print_look(&a.look);
            println!("{}", protocol::status_line(a.status.as_str()));
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Look { look: args, pretty } => {
            let entry = load_entry(&paths, &args, true)?;
            let (resolved, warnings) = look::resolve(&entry, &base);
            for w in &warnings.0 {
                eprintln!("{w}");
            }
            let v = Value::Object(resolved);
            let text = if pretty { serde_json::to_string_pretty(&v) } else { serde_json::to_string(&v) };
            println!("{}", text.map_err(|e| e.to_string())?);
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Teardown { look: args, purge } => {
            let entry = load_entry(&paths, &args, false)?;
            let ctx = Ctx { paths: &paths, hc: &hc, notify: &notify, build: &build };
            let status = teardown::run(&ctx, &entry, purge);
            println!("{}", protocol::status_line(status.as_str()));
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Status => {
            let available = hc.available();
            let listed = available && hc.plugin_listed(&paths.plugin_name);
            let mapped = if available { session::loaded_so(&hc, &paths.hyprctl_instance) } else { None };
            let id = abi::identity(&hc);
            let v = json!({
                "pluginId": paths.plugin_id,
                "pluginRoot": paths.plugin_root,
                "hyprSrc": paths.hypr_src,
                "sessionSo": paths.session_so,
                "sessionSoExists": paths.session_so.is_file(),
                "luaFile": paths.lua_file,
                "buildDir": paths.build_dir,
                "shellJson": paths.shell_json,
                "hyprctl": available,
                "instance": paths.hyprctl_instance,
                "listed": listed,
                "mappedSo": mapped,
                "abi": { "hash": id.hash, "headerMtime": id.header_mtime, "compiler": id.compiler,
                          "stampMatches": abi::identity_matches_stamp(&paths, &id),
                          "hashMismatchRecorded": abi::hash_mismatch_recorded(&paths),
                          "sessionSoFresh": abi::artifact_fresh(&paths, &id, &paths.session_so) },
                "theme": theme::current_name(&paths),
                "themePreset": theme::preset_name(&paths),
            });
            println!("{}", serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?);
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Theme => {
            let t = theme::current(&paths)?;
            println!("{}", serde_json::to_string_pretty(&t).map_err(|e| e.to_string())?);
            Ok(ExitCode::SUCCESS)
        }
        Cmd::ShellLook { cmd } => {
            let ids = paths.plugin_ids();
            match cmd {
                ShellLookCmd::Snapshot => {
                    if let Some(v) = shell_json::snapshot(&paths.shell_json, &ids) {
                        println!("{}", serde_json::to_string(&v).map_err(|e| e.to_string())?);
                    }
                }
                ShellLookCmd::Restore { json } => {
                    let saved = shell_json::parse_snapshot(&json)?;
                    shell_json::restore(&paths.shell_json, saved.as_ref(), &ids)?;
                }
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}
