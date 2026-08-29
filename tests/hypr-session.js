#!/usr/bin/env node
// Compositor-free tests for hypr-session.sh / reinstall order / hypr-ensure
// install path. Does not talk to a live Hyprland.

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn, spawnSync } = require("child_process")

const root = path.resolve(__dirname, "..")
let fails = 0

function check(cond, msg) {
  if (!cond) {
    fails++
    console.error("FAIL " + msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

function bash(script, env) {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: Object.assign({}, process.env, env || {}),
  })
}

function checkScriptShape() {
  const ensure = read("scripts/hypr-ensure.sh")
  const session = read("scripts/hypr-session.sh")
  const reinstall = read("scripts/reinstall.sh")
  const teardown = read("scripts/hypr-teardown.sh")
  const install = read("scripts/install.sh")

  check(session.indexOf("install_session_so") !== -1, "hypr-session defines install_session_so")
  check(session.indexOf("wait_plugin_gone") !== -1, "hypr-session defines wait_plugin_gone")
  check(session.indexOf("O_TRUNC") !== -1, "hypr-session comments the SIGBUS / O_TRUNC hazard")
  check(/mktemp .*hypr-shiny-border\.XXXXXX/.test(session), "install writes a sibling temp")
  check(session.indexOf('mv -f "$tmp" "$SESSION_SO"') !== -1, "install renames over SESSION_SO")

  check(ensure.indexOf("hypr-session.sh") !== -1, "hypr-ensure sources hypr-session.sh")
  check(ensure.indexOf("unload_session_so") !== -1, "hypr-ensure waits for unload")
  check(ensure.indexOf("plugin_mapped") !== -1, "hypr-ensure refuses a second mapped copy")
  check(
    !/\bload_session_so \|\| true/.test(ensure),
    "hypr-ensure does not swallow a failed plugin load"
  )
  check(ensure.indexOf("status load-failed") !== -1, "hypr-ensure emits STATUS=load-failed")
  check(
    ensure.indexOf("load_session_so_or_fail") !== -1,
    "hypr-ensure shares one fail-closed load path"
  )
  check(
    !/cp -f "\$src" "\$SESSION_SO"/.test(ensure),
    "hypr-ensure does not cp -f onto the live session .so"
  )
  const unloadCall = ensure.indexOf("if unload_session_so")
  const copyCall = ensure.indexOf("copy_session_so \"$BUILD_DIR")
  check(
    unloadCall !== -1 && copyCall !== -1 && unloadCall < copyCall,
    "hypr-ensure unloads and waits before replacing the session .so"
  )

  check(session.indexOf("hypr_session_lock") !== -1, "hypr-session defines hypr_session_lock")
  check(session.indexOf("look_effect_is_shiny") !== -1, "hypr-session defines look_effect_is_shiny")
  check(session.indexOf("hypr_session_bump_ensure_gen") !== -1, "hypr-session defines ensure generation")
  check(session.indexOf("hypr_abi_artifact_fresh") !== -1, "hypr-session defines hypr_abi_artifact_fresh")
  check(session.indexOf("hypr_abi_delete_session_so") !== -1, "hypr-session defines hypr_abi_delete_session_so")
  check(session.indexOf("hypr_abi_need_force_rebuild") !== -1, "hypr-session defines hypr_abi_need_force_rebuild")
  check(session.indexOf("sources_newer_than") !== -1, "hypr-session defines sources_newer_than")
  check(ensure.indexOf("hypr_abi_artifact_fresh") !== -1, "hypr-ensure uses ABI freshness")
  check(ensure.indexOf("hypr_abi_delete_session_so") !== -1, "hypr-ensure deletes the stale session .so")
  check(ensure.indexOf("hypr_abi_invalidate_objects") !== -1, "hypr-ensure wipes objects on ABI mismatch")
  check(ensure.indexOf("function sources_newer_than") === -1, "hypr-ensure does not keep a private sources_newer_than")
  const makefile = read("hypr/Makefile")
  check(makefile.indexOf("-MD") !== -1, "Makefile records header dependencies (-MD)")
  check(makefile.indexOf("COMPILER_STAMP") !== -1, "Makefile stamps compiler id")
  check(makefile.indexOf("-include") !== -1, "Makefile includes generated header deps")

  check(teardown.indexOf("hypr-session.sh") !== -1, "hypr-teardown sources hypr-session.sh")
  check(teardown.indexOf("wait_plugin_gone") !== -1, "hypr-teardown waits for unmap")
  check(teardown.indexOf("hypr_session_lock") !== -1, "hypr-teardown takes the session lock")
  check(teardown.indexOf("persist_disable") !== -1, "hypr-teardown persist-disables the window ring")

  check(ensure.indexOf("hypr_session_lock") !== -1, "hypr-ensure takes the session lock")
  check(ensure.indexOf("look_effect_is_shiny") !== -1, "hypr-ensure reads look JSON effect")

  check(reinstall.indexOf("hypr-session.sh") !== -1, "reinstall sources hypr-session.sh")
  check(reinstall.indexOf("wait_plugin_gone") !== -1, "reinstall waits until the plugin is gone")
  const restartAt = reinstall.indexOf("\nomarchy restart shell")
  const addAt = reinstall.indexOf("\nomarchy plugin add \"$add_url\"")
  check(restartAt !== -1 && addAt !== -1, "reinstall still restarts the shell and adds the plugin")
  check(restartAt < addAt, "reinstall restarts the shell before add --enable")
  check(
    reinstall.indexOf("aborting before add --enable") !== -1,
    "reinstall aborts rather than replacing a mapped .so"
  )
  check(
    reinstall.indexOf("\nomarchy restart shell", addAt) === -1,
    "reinstall does not restart the shell after add --enable"
  )

  check(install.indexOf("hypr-session.sh") !== -1, "mise install copies hypr-session.sh")
}

function checkInstallSessionSo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-session-"))
  const dest = path.join(dir, "hypr-shiny-border.so")
  const src = path.join(dir, "new.so")
  try {
    fs.writeFileSync(dest, "OLDINODE")
    fs.writeFileSync(src, "NEWINODE-CONTENT")
    const oldStat = fs.statSync(dest)
    const fd = fs.openSync(dest, "r")
    const beforeFd = Buffer.alloc(8)
    fs.readSync(fd, beforeFd, 0, 8, 0)

    const r = bash(
      'source "$ROOT/scripts/paths.sh"; source "$ROOT/scripts/hypr-session.sh"; SESSION_SO="$DEST"; install_session_so "$SRC"',
      { ROOT: root, DEST: dest, SRC: src }
    )
    check(r.status === 0, "install_session_so exits 0: " + (r.stderr || r.stdout || ""))

    const newStat = fs.statSync(dest)
    check(newStat.ino !== oldStat.ino, "install_session_so uses a new inode (no O_TRUNC)")
    check(fs.readFileSync(dest, "utf8") === "NEWINODE-CONTENT", "path sees the new bytes")

    const afterFd = Buffer.alloc(8)
    fs.readSync(fd, afterFd, 0, 8, 0)
    check(afterFd.toString("utf8") === "OLDINODE", "open fd still has the old inode after rename")
    check(beforeFd.toString("utf8") === "OLDINODE", "pre-install fd read was the old file")
    fs.closeSync(fd)

    const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith("hypr-shiny-border.") && n !== "hypr-shiny-border.so")
    check(leftovers.length === 0, "no leftover temp installs: " + leftovers.join(","))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeHyprctlStub(dir, body) {
  const stub = path.join(dir, "hyprctl")
  fs.writeFileSync(stub, "#!/usr/bin/env bash\n" + body)
  fs.chmodSync(stub, 0o755)
}

function checkWaitPluginGone() {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyprctl-empty-"))
  const listedDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyprctl-listed-"))
  try {
    writeHyprctlStub(
      emptyDir,
      `if [[ "$*" == *instances* ]]; then echo '[]'; exit 0; fi
if [[ "$*" == *plugin*list* ]]; then echo '[]'; exit 0; fi
exit 0
`
    )
    const gone = bash(
      'source "$ROOT/scripts/paths.sh"; source "$ROOT/scripts/hypr-session.sh"; wait_plugin_gone 0.3',
      { ROOT: root, PATH: emptyDir + ":/usr/bin:/bin" }
    )
    check(gone.status === 0, "wait_plugin_gone succeeds when nothing is listed: " + (gone.stderr || ""))

    writeHyprctlStub(
      listedDir,
      `if [[ "$*" == *instances* ]]; then echo '[]'; exit 0; fi
if [[ "$*" == *plugin*list* ]]; then echo '[{"name":"hypr-shiny-border"}]'; exit 0; fi
exit 0
`
    )
    const stuck = bash(
      'source "$ROOT/scripts/paths.sh"; source "$ROOT/scripts/hypr-session.sh"; wait_plugin_gone 0.3',
      { ROOT: root, PATH: listedDir + ":/usr/bin:/bin" }
    )
    check(stuck.status !== 0, "wait_plugin_gone fails while the plugin is still listed")
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true })
    fs.rmSync(listedDir, { recursive: true, force: true })
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function waitFor(pred, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    sleepMs(40)
  }
  return false
}

function logHas(logText, needle) {
  return logText.indexOf(needle) !== -1
}

function luaDisabled(luaFile) {
  if (!fs.existsSync(luaFile))
    return false
  const t = fs.readFileSync(luaFile, "utf8")
  return /SHINY_LOAD = false/.test(t) && /enabled\s*=\s*false/.test(t)
}

function luaEnabledLoad(luaFile) {
  if (!fs.existsSync(luaFile))
    return false
  const t = fs.readFileSync(luaFile, "utf8")
  return /SHINY_LOAD = true/.test(t) && /enabled\s*=\s*true/.test(t)
}

function readLog(p) {
  try {
    return fs.readFileSync(p, "utf8")
  } catch (e) {
    return ""
  }
}

function touchFuture(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  if (!fs.existsSync(p))
    fs.writeFileSync(p, Buffer.alloc(4096, 0x41))
  const future = new Date(Date.now() + 86400000)
  fs.utimesSync(p, future, future)
}

function writeHarnessHyprctlStub(harness) {
  const body = `#!/usr/bin/env bash
LOG=${JSON.stringify(harness.logPath)}
STATE=${JSON.stringify(harness.stateDir)}
UNLOAD_SLEEP=${Number(harness.unloadSleepSec || 0)}
UNLOAD_EXIT=${Number(harness.unloadExit || 0)}
LOAD_EXIT=${Number(harness.loadExit || 0)}
LOAD_MSG=${JSON.stringify(harness.loadMessage || "")}
stamp() { date +%s.%N; }
echo "$(stamp) BEGIN $*" >> "$LOG"

cleanup_map() {
  if [[ -f $STATE/map.pid ]]; then
    local pid
    pid=$(cat "$STATE/map.pid" 2>/dev/null || true)
    if [[ -n \${pid:-} ]]; then
      kill "$pid" 2>/dev/null || true
      local i
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.05
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$STATE/map.pid"
  fi
}

args="$*"

if [[ $args == *instances* ]]; then
  pid=""
  [[ -f $STATE/map.pid ]] && pid=$(cat "$STATE/map.pid" 2>/dev/null || true)
  if [[ -n \${pid:-} ]] && kill -0 "$pid" 2>/dev/null; then
    printf '[{"pid": %s}]\\n' "$pid"
  else
    echo '[]'
  fi
  echo "$(stamp) END $*" >> "$LOG"
  exit 0
fi

if [[ $args == *plugin*list* ]]; then
  if [[ -f $STATE/listed ]]; then
    cat "$STATE/listed"
  else
    echo '[]'
  fi
  echo "$(stamp) END $*" >> "$LOG"
  exit 0
fi

if [[ $args == *plugin*unload* ]]; then
  if awk "BEGIN { exit !($UNLOAD_SLEEP > 0) }"; then
    sleep "$UNLOAD_SLEEP"
  fi
  if [[ $UNLOAD_EXIT -ne 0 ]]; then
    echo "unload refused" >&2
    echo "$(stamp) END $*" >> "$LOG"
    exit "$UNLOAD_EXIT"
  fi
  echo '[]' > "$STATE/listed"
  cleanup_map
  echo "unloaded"
  echo "$(stamp) END $*" >> "$LOG"
  exit 0
fi

if [[ $args == *plugin*load* ]]; then
  if [[ $LOAD_EXIT -ne 0 ]]; then
    if [[ -n $LOAD_MSG ]]; then
      echo "$LOAD_MSG" >&2
    else
      echo "load refused" >&2
    fi
    echo "$(stamp) END $*" >> "$LOG"
    exit "$LOAD_EXIT"
  fi
  printf '%s\\n' '[{"name":"hypr-shiny-border"}]' > "$STATE/listed"
  echo "loaded"
  echo "$(stamp) END $*" >> "$LOG"
  exit 0
fi

if [[ $args == *eval* ]]; then
  echo "ok"
  echo "$(stamp) END $*" >> "$LOG"
  exit 0
fi

echo "$(stamp) END $*" >> "$LOG"
exit 0
`
  fs.writeFileSync(path.join(harness.binDir, "hyprctl"), body)
  fs.chmodSync(path.join(harness.binDir, "hyprctl"), 0o755)
}

function writeMakeStub(harness) {
  const body = `#!/usr/bin/env bash
echo "make $*" >> ${JSON.stringify(harness.makeLog)}
MAKE_EXIT=${Number(harness.makeExit === undefined ? 1 : harness.makeExit)}
if [[ $MAKE_EXIT -ne 0 ]]; then
  exit "$MAKE_EXIT"
fi
build_dir=""
for a in "$@"; do
  case "$a" in
    BUILD_DIR=*) build_dir="\${a#BUILD_DIR=}" ;;
  esac
done
if [[ -z $build_dir ]]; then
  echo "make stub: missing BUILD_DIR" >&2
  exit 1
fi
mkdir -p "$build_dir"
printf 'BUILT-SO' > "$build_dir/hypr-shiny-border.so"
chmod 755 "$build_dir/hypr-shiny-border.so"
exit 0
`
  fs.writeFileSync(path.join(harness.binDir, "make"), body)
  fs.chmodSync(path.join(harness.binDir, "make"), 0o755)
}

function startMapper(harness, soPath) {
  fs.mkdirSync(path.dirname(soPath), { recursive: true })
  fs.writeFileSync(soPath, Buffer.alloc(4096, 0x41))
  const pidFile = path.join(harness.stateDir, "map.pid")
  const py = path.join(harness.dir, "mapper.py")
  fs.writeFileSync(
    py,
    [
      "import mmap, os, sys, time",
      "path, pid_path = sys.argv[1], sys.argv[2]",
      "fd = os.open(path, os.O_RDONLY)",
      "mm = mmap.mmap(fd, 0, access=mmap.ACCESS_READ)",
      "open(pid_path, 'w').write(str(os.getpid()))",
      "while True:",
      "    time.sleep(0.2)",
    ].join("\n") + "\n"
  )
  const child = spawn("python3", [py, soPath, pidFile], {
    stdio: "ignore",
    detached: true,
  })
  child.unref()
  const ok = waitFor(() => {
    if (!fs.existsSync(pidFile))
      return false
    const pid = Number(String(fs.readFileSync(pidFile, "utf8")).trim())
    if (!pid)
      return false
    try {
      return fs.readFileSync("/proc/" + pid + "/maps", "utf8").indexOf("hypr-shiny-border.so") !== -1
    } catch (e) {
      return false
    }
  }, 3000)
  if (!ok) {
    try { child.kill("SIGKILL") } catch (e) { /* ignore */ }
    throw new Error("mapper did not appear in /proc/pid/maps for " + soPath)
  }
  harness.mapper = child
  harness.mapperPid = Number(String(fs.readFileSync(pidFile, "utf8")).trim())
  return harness.mapperPid
}

function createHarness(opts) {
  opts = opts || {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-session-"))
  const binDir = path.join(dir, "bin")
  const home = path.join(dir, "home")
  const config = path.join(dir, "config")
  const cache = path.join(dir, "cache")
  const runDir = path.join(dir, "run")
  const stateDir = path.join(dir, "state")
  fs.mkdirSync(binDir)
  fs.mkdirSync(home)
  fs.mkdirSync(config, { recursive: true })
  fs.mkdirSync(path.join(config, "hypr"), { recursive: true })
  fs.mkdirSync(cache)
  fs.mkdirSync(runDir)
  fs.mkdirSync(stateDir)
  const sessionSo = path.join(dir, "lib", "hypr-shiny-border.so")
  const hyprpmSo = path.join(dir, "hyprpm", "hypr-shiny-border.so")
  const luaFile = path.join(config, "hypr", "border-fx.lua")
  const logPath = path.join(dir, "hyprctl.log")
  const makeLog = path.join(dir, "make.log")
  const buildDir = path.join(cache, "omarchy-border-fx")
  fs.mkdirSync(buildDir, { recursive: true })
  const abiStamp = path.join(buildDir, "abi-identity")
  const abiMismatch = path.join(buildDir, "hash-mismatch")
  const abiHash = opts.abiHash || "test-hash"
  const abiHeaderMtime = opts.abiHeaderMtime != null ? String(opts.abiHeaderMtime) : "1"
  const abiCompiler = opts.abiCompiler || "test-compiler"
  if (opts.writeAbiStamp !== false) {
    fs.writeFileSync(
      abiStamp,
      "hash=" + abiHash + "\nheader_mtime=" + abiHeaderMtime + "\ncompiler=" + abiCompiler + "\n"
    )
  }
  const harness = {
    dir: dir,
    binDir: binDir,
    stateDir: stateDir,
    sessionSo: sessionSo,
    hyprpmSo: hyprpmSo,
    luaFile: luaFile,
    logPath: logPath,
    makeLog: makeLog,
    buildDir: buildDir,
    abiStamp: abiStamp,
    abiMismatch: abiMismatch,
    unloadSleepSec: opts.unloadSleepSec || 0,
    unloadExit: opts.unloadExit || 0,
    makeExit: opts.makeExit === undefined ? 1 : Number(opts.makeExit),
    loadExit: opts.loadExit === undefined ? 0 : Number(opts.loadExit),
    loadMessage: opts.loadMessage || "",
    mapper: null,
    mapperPid: 0,
  }
  fs.writeFileSync(path.join(stateDir, "listed"), opts.listed ? '[{"name":"hypr-shiny-border"}]\n' : "[]\n")
  writeHarnessHyprctlStub(harness)
  writeMakeStub(harness)
  const env = Object.assign({}, process.env, {
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_RUNTIME_DIR: runDir,
    LUA_FILE: luaFile,
    SESSION_SO: sessionSo,
    BUILD_DIR: buildDir,
    HYPR_ABI_STAMP: abiStamp,
    HYPR_ABI_HASH_MISMATCH: abiMismatch,
    HYPR_ABI_COMPOSITOR_HASH: abiHash,
    HYPR_ABI_HEADER_MTIME: abiHeaderMtime,
    HYPR_ABI_COMPILER_ID: abiCompiler,
    PATH: binDir + ":" + (process.env.PATH || "/usr/bin:/bin"),
  })
  if (opts.hyprSrc) {
    env.HYPR_SRC = opts.hyprSrc
    fs.mkdirSync(path.join(opts.hyprSrc, "src"), { recursive: true })
    if (!fs.existsSync(path.join(opts.hyprSrc, "Makefile")))
      fs.writeFileSync(path.join(opts.hyprSrc, "Makefile"), "all:\n\t@false\n")
  }
  harness.env = env
  if (opts.map === "session")
    startMapper(harness, sessionSo)
  else if (opts.map === "hyprpm")
    startMapper(harness, hyprpmSo)
  return harness
}

function stopHarness(harness) {
  if (!harness)
    return
  if (harness.mapper) {
    try { harness.mapper.kill("SIGKILL") } catch (e) { /* ignore */ }
  }
  if (harness.mapperPid) {
    try { process.kill(harness.mapperPid, "SIGKILL") } catch (e) { /* ignore */ }
  }
  fs.rmSync(harness.dir, { recursive: true, force: true })
}

function runTeardown(harness) {
  return spawnSync("bash", [path.join(root, "scripts/hypr-teardown.sh")], {
    encoding: "utf8",
    env: harness.env,
    timeout: 20000,
  })
}

function runEnsure(harness, lookJson) {
  return spawnSync("bash", [path.join(root, "scripts/hypr-ensure.sh"), "--look-json", lookJson], {
    encoding: "utf8",
    env: harness.env,
    timeout: 20000,
  })
}

function eventTimes(logText, needle) {
  const times = []
  logText.split("\n").forEach((line) => {
    if (line.indexOf(needle) === -1)
      return
    const m = line.match(/^(\d+\.\d+)\s+(BEGIN|END)\s+/)
    if (m)
      times.push({ t: Number(m[1]), phase: m[2], line: line })
  })
  return times
}

const evidenceChunks = { teardown: [], ensure: [], lock: [], hotReload: [], abi: [] }

function statusLines(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.indexOf("STATUS=") === 0)
}

function note(bucket, msg) {
  evidenceChunks[bucket].push(msg)
  console.log(msg)
}

function checkTeardownPersist() {
  let h

  h = createHarness({ listed: true, map: "session" })
  try {
    const r = runTeardown(h)
    const log = readLog(h.logPath)
    check(r.status === 0, "teardown session-copy exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "session-copy unload still writes SHINY_LOAD=false and enabled=false")
    check(logHas(log, "plugin unload"), "session-copy teardown unloads the session .so")
    check(!logHas(log, "eval"), "session-copy unload does not --eval (plugin no longer listed)")
    check(!logHas(log, "dofile"), "session-copy unload does not dofile")
    note("teardown", "session-copy unload: luaDisabled=" + luaDisabled(h.luaFile) + " eval=" + logHas(log, "eval") + " status=" + r.status)
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: true, map: "hyprpm" })
  try {
    const r = runTeardown(h)
    const log = readLog(h.logPath)
    check(r.status === 0, "teardown hyprpm exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "hyprpm teardown writes disabled Lua")
    check(!logHas(log, "plugin unload"), "hyprpm teardown does not unload a non-session copy")
    check(logHas(log, "eval") || logHas(log, "dofile"), "hyprpm teardown --eval (plugin still listed)")
    note("teardown", "hyprpm listed: lua disabled=" + luaDisabled(h.luaFile) + " eval=" + (logHas(log, "eval") || logHas(log, "dofile")))
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: true })
  try {
    const r = runTeardown(h)
    const log = readLog(h.logPath)
    check(r.status === 0, "teardown listed-unknown exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "listed-unknown teardown writes disabled Lua")
    check(!logHas(log, "plugin unload"), "listed-unknown teardown does not unload")
    check(logHas(log, "eval") || logHas(log, "dofile"), "listed-unknown teardown --eval")
    note("teardown", "listed-unknown: lua disabled=" + luaDisabled(h.luaFile) + " eval=yes")
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: true, map: "session", unloadExit: 1 })
  try {
    const r = runTeardown(h)
    const log = readLog(h.logPath)
    check(r.status === 0, "teardown unload-refused exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "unload-refused teardown writes disabled Lua")
    check(logHas(log, "eval") || logHas(log, "dofile"), "unload-refused teardown --eval (still listed)")
    note("teardown", "unload-refused: lua disabled=" + luaDisabled(h.luaFile) + " eval=yes")
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: false })
  try {
    const r = runTeardown(h)
    const log = readLog(h.logPath)
    check(r.status === 0, "teardown not-listed exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "not-listed teardown writes disabled Lua")
    check(!logHas(log, "eval") && !logHas(log, "dofile"), "not-listed teardown does not --eval")
    note("teardown", "not-listed: lua disabled=" + luaDisabled(h.luaFile) + " eval=no")
  } finally {
    stopHarness(h)
  }
}

function checkEnsureTree() {
  let h

  h = createHarness({})
  try {
    const r = runEnsure(h, JSON.stringify({ effect: "other" }))
    const log = readLog(h.logPath)
    const make = readLog(h.makeLog)
    check(r.status === 0, "ensure non-shiny idle exits 0: " + (r.stderr || r.stdout || ""))
    check((r.stdout || "").indexOf("STATUS=skipped") !== -1, "ensure non-shiny idle STATUS=skipped")
    check(luaDisabled(h.luaFile), "ensure non-shiny idle writes disabled Lua")
    check(!logHas(log, "plugin load"), "ensure non-shiny idle does not plugin load")
    check(make.length === 0, "ensure non-shiny idle does not compile")
    note("ensure", "non-shiny idle: load=" + logHas(log, "plugin load") + " make=" + (make.length > 0) + " luaDisabled=" + luaDisabled(h.luaFile))
  } finally {
    stopHarness(h)
  }

  h = createHarness({})
  try {
    touchFuture(h.sessionSo)
    const r = runEnsure(h, "{}")
    const log = readLog(h.logPath)
    check(r.status === 0, "ensure {} idle exits 0: " + (r.stderr || r.stdout || ""))
    check((r.stdout || "").indexOf("STATUS=ok") !== -1, "ensure {} idle STATUS=ok: " + (r.stdout || ""))
    check(logHas(log, "plugin load"), "ensure {} idle plugin loads")
    check(luaEnabledLoad(h.luaFile), "ensure {} idle writes SHINY_LOAD=true")
    note("ensure", "shiny {}: load=" + logHas(log, "plugin load") + " status=" + String(r.stdout || "").trim())
  } finally {
    stopHarness(h)
  }

  h = createHarness({})
  try {
    touchFuture(h.sessionSo)
    const r = runEnsure(h, JSON.stringify({ effect: "shiny" }))
    const log = readLog(h.logPath)
    check(r.status === 0, "ensure effect=shiny idle exits 0: " + (r.stderr || r.stdout || ""))
    check(logHas(log, "plugin load"), "ensure effect=shiny idle plugin loads")
    check(luaEnabledLoad(h.luaFile), "ensure effect=shiny idle writes enabled Lua")
    note("ensure", "effect shiny: load=" + logHas(log, "plugin load"))
  } finally {
    stopHarness(h)
  }

  h = createHarness({})
  try {
    touchFuture(h.sessionSo)
    const r = runEnsure(h, JSON.stringify({ effect: "" }))
    const log = readLog(h.logPath)
    check(r.status === 0, "ensure empty effect idle exits 0: " + (r.stderr || r.stdout || ""))
    check(logHas(log, "plugin load"), "empty effect is shiny: plugin load allowed")
    note("ensure", "empty effect: load=" + logHas(log, "plugin load"))
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: true, map: "session" })
  try {
    const r = runEnsure(h, JSON.stringify({ effect: "other" }))
    const log = readLog(h.logPath)
    const make = readLog(h.makeLog)
    check(r.status === 0, "ensure non-shiny listed session exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "non-shiny listed session writes disabled Lua")
    check(logHas(log, "plugin unload"), "non-shiny listed session unloads leftover session plugin")
    check(!logHas(log, "plugin load"), "non-shiny listed session does not plugin load")
    check(make.length === 0, "non-shiny listed session does not compile")
    const stillMapped = harnessMapperAlive(h)
    check(!stillMapped, "non-shiny listed session does not leave the plugin mapped")
    note("ensure", "non-shiny listed session: unload=" + logHas(log, "plugin unload") + " load=" + logHas(log, "plugin load") + " mapped=" + stillMapped)
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: true, map: "hyprpm" })
  try {
    const r = runEnsure(h, JSON.stringify({ effect: "other" }))
    const log = readLog(h.logPath)
    const make = readLog(h.makeLog)
    check(r.status === 0, "ensure non-shiny hyprpm exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "non-shiny hyprpm writes disabled Lua")
    check(!logHas(log, "plugin load"), "non-shiny hyprpm does not plugin load")
    check(!logHas(log, "plugin unload"), "non-shiny hyprpm does not unload the hyprpm copy")
    check(logHas(log, "eval") || logHas(log, "dofile"), "non-shiny hyprpm --eval disabled Lua")
    check(make.length === 0, "non-shiny hyprpm does not compile")
    note("ensure", "non-shiny hyprpm: load=" + logHas(log, "plugin load") + " unload=" + logHas(log, "plugin unload") + " eval=yes")
  } finally {
    stopHarness(h)
  }

  h = createHarness({ listed: false, map: "session" })
  try {
    const r = runEnsure(h, JSON.stringify({ effect: "other" }))
    const log = readLog(h.logPath)
    const make = readLog(h.makeLog)
    check(r.status === 0, "ensure non-shiny mapped-not-listed exits 0: " + (r.stderr || r.stdout || ""))
    check(luaDisabled(h.luaFile), "non-shiny mapped-not-listed writes disabled Lua")
    check(logHas(log, "plugin unload"), "non-shiny mapped-not-listed unloads leftover mapping")
    check(!logHas(log, "plugin load"), "non-shiny mapped-not-listed does not plugin load")
    check(make.length === 0, "non-shiny mapped-not-listed does not compile")
    check(!harnessMapperAlive(h), "non-shiny mapped-not-listed does not leave the plugin mapped")
    note("ensure", "non-shiny mapped-not-listed: unload=" + logHas(log, "plugin unload") + " load=" + logHas(log, "plugin load"))
  } finally {
    stopHarness(h)
  }

  const hyprSrc = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-src-"))
  try {
    h = createHarness({ hyprSrc: hyprSrc })
    try {
      const r = runEnsure(h, JSON.stringify({ effect: "other" }))
      const log = readLog(h.logPath)
      const make = readLog(h.makeLog)
      check(r.status === 0, "ensure non-shiny build-fail state exits 0: " + (r.stderr || r.stdout || ""))
      check(luaDisabled(h.luaFile), "non-shiny build-fail state writes disabled Lua")
      check(!logHas(log, "plugin load"), "non-shiny build-fail state does not plugin load")
      check(make.length === 0, "non-shiny build-fail state skips compile (make not invoked)")
      note("ensure", "non-shiny build-fail: makeInvoked=" + (make.length > 0) + " load=" + logHas(log, "plugin load"))
    } finally {
      stopHarness(h)
    }

    h = createHarness({ hyprSrc: hyprSrc })
    try {
      const r = runEnsure(h, "{}")
      const log = readLog(h.logPath)
      const make = readLog(h.makeLog)
      check(r.status === 0, "ensure shiny build-fail exits 0: " + (r.stderr || r.stdout || ""))
      check((r.stdout || "").indexOf("STATUS=build-failed") !== -1, "ensure shiny build-fail STATUS=build-failed: " + (r.stdout || ""))
      check(make.length > 0, "ensure shiny build-fail invokes make")
      check(!logHas(log, "plugin load"), "ensure shiny build-fail does not plugin load")
      note("ensure", "shiny build-fail: status=" + String(r.stdout || "").trim() + " makeInvoked=" + (make.length > 0))
    } finally {
      stopHarness(h)
    }
  } finally {
    fs.rmSync(hyprSrc, { recursive: true, force: true })
  }

  h = createHarness({ loadExit: 1 })
  try {
    touchFuture(h.sessionSo)
    const r = runEnsure(h, "{}")
    const log = readLog(h.logPath)
    check(r.status === 0, "ensure cold load-fail exits 0: " + (r.stderr || r.stdout || ""))
    check((r.stdout || "").indexOf("STATUS=load-failed") !== -1, "ensure cold load-fail STATUS=load-failed: " + (r.stdout || ""))
    check((r.stdout || "").indexOf("STATUS=ok") === -1, "ensure cold load-fail is not STATUS=ok")
    check(logHas(log, "plugin load"), "ensure cold load-fail still attempts plugin load")
    check(fs.existsSync(h.sessionSo), "ensure generic load-fail does not delete the session .so")
    note("ensure", "cold load-fail: status=" + statusLines(r.stdout).join(",") + " load=" + logHas(log, "plugin load"))
  } finally {
    stopHarness(h)
  }

  const hyprSrcOk = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-src-"))
  try {
    h = createHarness({ listed: true, map: "session", hyprSrc: hyprSrcOk, makeExit: 0 })
    try {
      touchFuture(path.join(hyprSrcOk, "src", "main.cpp"))
      const r = runEnsure(h, "{}")
      const log = readLog(h.logPath)
      const make = readLog(h.makeLog)
      check(r.status === 0, "ensure hot-reload success exits 0: " + (r.stderr || r.stdout || ""))
      check((r.stdout || "").indexOf("STATUS=ok") !== -1, "ensure hot-reload success STATUS=ok: " + (r.stdout || ""))
      check((r.stdout || "").indexOf("STATUS=load-failed") === -1, "ensure hot-reload success is not load-failed")
      check(logHas(log, "plugin unload"), "ensure hot-reload success unloads first")
      check(logHas(log, "plugin load"), "ensure hot-reload success plugin loads")
      check(make.length > 0, "ensure hot-reload success rebuilds")
      note("ensure", "hot-reload success: status=" + statusLines(r.stdout).join(",") + " makeInvoked=" + (make.length > 0))
    } finally {
      stopHarness(h)
    }
  } finally {
    fs.rmSync(hyprSrcOk, { recursive: true, force: true })
  }
}

function harnessMapperAlive(h) {
  if (!h.mapperPid)
    return false
  try {
    const maps = fs.readFileSync("/proc/" + h.mapperPid + "/maps", "utf8")
    return maps.indexOf("hypr-shiny-border.so") !== -1
  } catch (e) {
    return false
  }
}

function runOverlapOnce() {
  const h = createHarness({ listed: true, map: "session", unloadSleepSec: 0.8 })
  touchFuture(h.sessionSo)
  const teardownOut = path.join(h.dir, "teardown.out")
  const teardownErr = path.join(h.dir, "teardown.err")
  const outFd = fs.openSync(teardownOut, "w")
  const errFd = fs.openSync(teardownErr, "w")
  let td
  let ensure
  try {
    td = spawn("bash", [path.join(root, "scripts/hypr-teardown.sh")], {
      env: h.env,
      stdio: ["ignore", outFd, errFd],
    })
    const sawUnload = waitFor(() => logHas(readLog(h.logPath), "plugin unload"), 5000)
    ensure = runEnsure(h, "{}")
    const dead = waitFor(() => {
      try {
        process.kill(td.pid, 0)
        return false
      } catch (e) {
        return true
      }
    }, 10000)
    const log = readLog(h.logPath)
    const unloads = eventTimes(log, "plugin unload")
    const loads = eventTimes(log, "plugin load")
    const unloadEnds = unloads.filter((e) => e.phase === "END")
    const loadBegins = loads.filter((e) => e.phase === "BEGIN")
    const loadEnds = loads.filter((e) => e.phase === "END")
    const unloadAfterLoad = unloads.some((u) =>
      u.phase === "BEGIN" && loadEnds.some((l) => u.t > l.t)
    )
    const loadAfterUnloadEnd =
      sawUnload &&
      unloadEnds.length > 0 &&
      loadBegins.length > 0 &&
      loadBegins[0].t >= unloadEnds[unloadEnds.length - 1].t
    return {
      sawUnload: sawUnload,
      teardownDead: dead,
      ensureStatus: ensure.status,
      ensureStdout: String(ensure.stdout || ""),
      ensureStderr: String(ensure.stderr || ""),
      loaded: logHas(log, "plugin load"),
      loadAfterUnloadEnd: loadAfterUnloadEnd,
      unloadAfterLoad: unloadAfterLoad,
      log: log,
      teardownOut: readLog(teardownOut),
      teardownErr: readLog(teardownErr),
    }
  } finally {
    if (td && td.exitCode === null) {
      try { td.kill("SIGKILL") } catch (e) { /* ignore */ }
    }
    try { fs.closeSync(outFd) } catch (e) { /* ignore */ }
    try { fs.closeSync(errFd) } catch (e) { /* ignore */ }
    stopHarness(h)
  }
}

function runEnsureHotReloadLoadFailed() {
  const hyprSrc = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-src-"))
  const h = createHarness({
    listed: true,
    map: "session",
    hyprSrc: hyprSrc,
    makeExit: 0,
    loadExit: 1,
  })
  try {
    touchFuture(path.join(hyprSrc, "src", "main.cpp"))
    const r = runEnsure(h, "{}")
    return {
      status: r.status,
      stdout: String(r.stdout || ""),
      stderr: String(r.stderr || ""),
      log: readLog(h.logPath),
      make: readLog(h.makeLog),
    }
  } finally {
    stopHarness(h)
    fs.rmSync(hyprSrc, { recursive: true, force: true })
  }
}

function checkEnsureHotReloadLoadFailed() {
  const a = runEnsureHotReloadLoadFailed()
  const b = runEnsureHotReloadLoadFailed()
  function summarize(run, label) {
    const msg =
      label +
      " status=" +
      run.status +
      " STATUS=" +
      statusLines(run.stdout).join(",") +
      " hasOk=" +
      (run.stdout.indexOf("STATUS=ok") !== -1) +
      " unload=" +
      logHas(run.log, "plugin unload") +
      " load=" +
      logHas(run.log, "plugin load") +
      " makeInvoked=" +
      (run.make.length > 0)
    note("hotReload", msg)
    note("hotReload", label + " stdout:\n" + run.stdout)
    note("hotReload", label + " stderr:\n" + run.stderr)
    return msg
  }
  summarize(a, "run1")
  summarize(b, "run2")
  function assertFailClosed(run, label) {
    check(run.status === 0, label + " hot-reload load-fail exits 0: " + (run.stderr || run.stdout || ""))
    check(run.stdout.indexOf("STATUS=load-failed") !== -1, label + " hot-reload load-fail STATUS=load-failed: " + run.stdout)
    check(run.stdout.indexOf("STATUS=ok") === -1, label + " hot-reload load-fail is not STATUS=ok")
    check(statusLines(run.stdout).join(",") === "STATUS=load-failed", label + " hot-reload emits only STATUS=load-failed")
    check(logHas(run.log, "plugin unload"), label + " hot-reload load-fail unloads the session copy")
    check(logHas(run.log, "plugin load"), label + " hot-reload load-fail attempts plugin load")
    check(run.make.length > 0, label + " hot-reload load-fail rebuilds before load")
  }
  assertFailClosed(a, "run1")
  assertFailClosed(b, "run2")
  check(
    a.status === b.status &&
      (a.stdout.indexOf("STATUS=load-failed") !== -1) === (b.stdout.indexOf("STATUS=load-failed") !== -1) &&
      (a.stdout.indexOf("STATUS=ok") !== -1) === (b.stdout.indexOf("STATUS=ok") !== -1) &&
      logHas(a.log, "plugin load") === logHas(b.log, "plugin load") &&
      (a.make.length > 0) === (b.make.length > 0),
    "both hot-reload load-fail runs agree"
  )
}

function checkTeardownEnsureLock() {
  const a = runOverlapOnce()
  const b = runOverlapOnce()
  function summarize(run, label) {
    const msg =
      label +
      " sawUnload=" +
      run.sawUnload +
      " loadAfterUnloadEnd=" +
      run.loadAfterUnloadEnd +
      " unloadAfterLoad=" +
      run.unloadAfterLoad +
      " loaded=" +
      run.loaded +
      " ensureStatus=" +
      run.ensureStatus +
      " STATUS line=" +
      String(run.ensureStdout || "").split("\n").filter((l) => l.indexOf("STATUS=") === 0).join(",")
    note("lock", msg)
    return msg
  }
  summarize(a, "run1")
  summarize(b, "run2")
  check(a.sawUnload && b.sawUnload, "both overlap runs started teardown unload first")
  check(a.loadAfterUnloadEnd, "run1: ensure plugin load waits until teardown unload finished")
  check(b.loadAfterUnloadEnd, "run2: ensure plugin load waits until teardown unload finished")
  check(!a.unloadAfterLoad, "run1: delayed teardown unload did not fire after ensure load")
  check(!b.unloadAfterLoad, "run2: delayed teardown unload did not fire after ensure load")
  check(a.loaded && b.loaded, "both overlap runs still plugin-load after teardown")
  check(a.ensureStatus === 0 && b.ensureStatus === 0, "both overlap ensure runs exit 0")
  check(
    a.loadAfterUnloadEnd === b.loadAfterUnloadEnd && a.unloadAfterLoad === b.unloadAfterLoad && a.loaded === b.loaded,
    "both overlap runs agree"
  )
}

function plantStaleSo(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  const future = new Date(Date.now() + 86400000)
  fs.utimesSync(file, future, future)
}

function writeAbiStampValues(stampPath, hash, mtime, compiler) {
  fs.mkdirSync(path.dirname(stampPath), { recursive: true })
  fs.writeFileSync(
    stampPath,
    "hash=" + hash + "\nheader_mtime=" + mtime + "\ncompiler=" + compiler + "\n"
  )
}

function applyAbiKind(h, kind) {
  if (kind === "hash")
    h.env.HYPR_ABI_COMPOSITOR_HASH = "upgraded-hash"
  else if (kind === "header")
    h.env.HYPR_ABI_HEADER_MTIME = "999999"
  else if (kind === "compiler")
    h.env.HYPR_ABI_COMPILER_ID = "other-compiler"
  else if (kind === "flag")
    fs.writeFileSync(h.abiMismatch, "1\n")
  else
    throw new Error("unknown abi kind " + kind)
}

function checkAbiHelperPredicate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-abi-helper-"))
  const so = path.join(dir, "hypr-shiny-border.so")
  const stamp = path.join(dir, "abi-identity")
  const flag = path.join(dir, "hash-mismatch")
  const srcDir = path.join(dir, "src")
  fs.mkdirSync(srcDir)
  fs.writeFileSync(path.join(srcDir, "main.cpp"), "// old\n")
  const past = new Date(Date.now() - 86400000)
  fs.utimesSync(path.join(srcDir, "main.cpp"), past, past)
  touchFuture(so)
  fs.writeFileSync(stamp, "hash=aaa\nheader_mtime=10\ncompiler=gcc-1\n")
  const env = {
    ROOT: root,
    SESSION_SO: so,
    HYPR_SRC: dir,
    HYPR_ABI_STAMP: stamp,
    HYPR_ABI_HASH_MISMATCH: flag,
    HYPR_ABI_COMPOSITOR_HASH: "aaa",
    HYPR_ABI_HEADER_MTIME: "10",
    HYPR_ABI_COMPILER_ID: "gcc-1",
  }

  function probe(extraEnv) {
    const r = bash(
      'source "$ROOT/scripts/paths.sh"; source "$ROOT/scripts/hypr-session.sh"; if hypr_abi_artifact_fresh "$SESSION_SO"; then echo FRESH; else echo STALE; fi',
      Object.assign({}, env, extraEnv || {})
    )
    check(r.status === 0, "artifact_fresh probe exits 0: " + (r.stderr || r.stdout || ""))
    return String(r.stdout || "").trim()
  }

  check(probe() === "FRESH", "matching identity is fresh")
  check(probe({ HYPR_ABI_COMPOSITOR_HASH: "bbb" }) === "STALE", "compositor hash mismatch is stale")
  check(probe({ HYPR_ABI_HEADER_MTIME: "99" }) === "STALE", "header mtime mismatch is stale")
  check(probe({ HYPR_ABI_COMPILER_ID: "gcc-2" }) === "STALE", "compiler id mismatch is stale")
  fs.writeFileSync(flag, "1\n")
  check(probe() === "STALE", "recorded hash-mismatch flag is stale")
  fs.rmSync(flag, { force: true })
  check(probe() === "FRESH", "cleared hash-mismatch flag is fresh again")

  const force = bash(
    'source "$ROOT/scripts/paths.sh"; source "$ROOT/scripts/hypr-session.sh"; if hypr_abi_need_force_rebuild; then echo FORCE; else echo NOFORCE; fi',
    Object.assign({}, env, { HYPR_ABI_COMPOSITOR_HASH: "bbb" })
  )
  check(force.status === 0 && String(force.stdout || "").trim() === "FORCE", "hash mismatch needs force rebuild")

  const del = bash(
    'source "$ROOT/scripts/paths.sh"; source "$ROOT/scripts/hypr-session.sh"; hypr_abi_delete_session_so; test ! -e "$SESSION_SO"',
    env
  )
  check(del.status === 0, "hypr_abi_delete_session_so unlinks SESSION_SO")
  fs.rmSync(dir, { recursive: true, force: true })
}

function runAbiEnsureMismatchOnce(kind) {
  const hyprSrc = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-abi-src-"))
  fs.mkdirSync(path.join(hyprSrc, "src"), { recursive: true })
  const srcFile = path.join(hyprSrc, "src", "main.cpp")
  fs.writeFileSync(srcFile, "// plugin source\n")
  const past = new Date(Date.now() - 86400000)
  fs.utimesSync(srcFile, past, past)
  const h = createHarness({ hyprSrc: hyprSrc, makeExit: 0 })
  try {
    applyAbiKind(h, kind)
    plantStaleSo(h.sessionSo, "STALE-SESSION-SO")
    const oldStat = fs.statSync(h.sessionSo)
    const cacheSo = path.join(h.buildDir, "hypr-shiny-border.so")
    plantStaleSo(cacheSo, "STALE-CACHE-SO")
    const objDir = path.join(h.buildDir, "obj")
    fs.mkdirSync(objDir, { recursive: true })
    fs.writeFileSync(path.join(objDir, "main.o"), "OLD-OBJECT")

    const r1 = runEnsure(h, "{}")
    const make1 = readLog(h.makeLog)
    const after1 = fs.existsSync(h.sessionSo) ? fs.readFileSync(h.sessionSo, "utf8") : ""
    const ino1 = fs.existsSync(h.sessionSo) ? fs.statSync(h.sessionSo).ino : 0
    let objAfter = ""
    if (fs.existsSync(path.join(objDir, "main.o")))
      objAfter = fs.readFileSync(path.join(objDir, "main.o"), "utf8")
    const cacheAfter = fs.existsSync(cacheSo) ? fs.readFileSync(cacheSo, "utf8") : ""

    // First load left the stub "listed". Cold-start the same mismatch fixture
    // so the next ensure cannot skip via STATUS=reuse / unknown path.
    fs.writeFileSync(path.join(h.stateDir, "listed"), "[]\n")
    plantStaleSo(h.sessionSo, "STALE-SESSION-SO-AGAIN")
    writeAbiStampValues(h.abiStamp, "test-hash", "1", "test-compiler")
    if (kind === "flag")
      fs.writeFileSync(h.abiMismatch, "1\n")
    plantStaleSo(cacheSo, "STALE-CACHE-SO-AGAIN")
    fs.mkdirSync(objDir, { recursive: true })
    fs.writeFileSync(path.join(objDir, "main.o"), "OLD-OBJECT-AGAIN")
    const r2 = runEnsure(h, "{}")
    const make2 = readLog(h.makeLog)
    const after2 = fs.existsSync(h.sessionSo) ? fs.readFileSync(h.sessionSo, "utf8") : ""
    const obj2 = fs.existsSync(path.join(objDir, "main.o"))
      ? fs.readFileSync(path.join(objDir, "main.o"), "utf8")
      : ""

    return {
      kind: kind,
      status1: r1.status,
      stdout1: String(r1.stdout || ""),
      stderr1: String(r1.stderr || ""),
      log1: readLog(h.logPath),
      make1: make1,
      after1: after1,
      ino1: ino1,
      oldIno: oldStat.ino,
      objAfter: objAfter,
      cacheAfter: cacheAfter,
      status2: r2.status,
      stdout2: String(r2.stdout || ""),
      make2: make2,
      after2: after2,
      obj2: obj2,
    }
  } finally {
    stopHarness(h)
    fs.rmSync(hyprSrc, { recursive: true, force: true })
  }
}

function checkAbiEnsureMismatch() {
  const kinds = ["hash", "header", "compiler", "flag"]
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]
    const a = runAbiEnsureMismatchOnce(kind)
    const b = runAbiEnsureMismatchOnce(kind)

    function summarize(run, label) {
      const msg =
        label +
        " status1=" +
        run.status1 +
        " STATUS=" +
        statusLines(run.stdout1).join(",") +
        " make1=" +
        (run.make1.length > 0) +
        " session=" +
        JSON.stringify(run.after1) +
        " inoChanged=" +
        (run.ino1 !== run.oldIno) +
        " obj=" +
        JSON.stringify(run.objAfter) +
        " cache=" +
        JSON.stringify(run.cacheAfter) +
        " status2=" +
        run.status2 +
        " makeGrew=" +
        (run.make2.length > run.make1.length) +
        " session2=" +
        JSON.stringify(run.after2)
      note("abi", msg)
      return msg
    }

    summarize(a, kind + " run1")
    summarize(b, kind + " run2")

    function assertMismatch(run, label) {
      check(run.status1 === 0, label + " first ensure exits 0: " + (run.stderr1 || run.stdout1 || ""))
      check(run.stdout1.indexOf("STATUS=ok") !== -1, label + " first ensure STATUS=ok: " + run.stdout1)
      check(run.make1.length > 0, label + " first ensure rebuilds (make invoked)")
      check(logHas(run.log1, "plugin load"), label + " first ensure plugin loads")
      check(run.after1 === "BUILT-SO", label + " first ensure session .so is newly built, not stale: " + JSON.stringify(run.after1))
      check(run.ino1 !== run.oldIno, label + " first ensure replaced the session .so inode")
      check(run.objAfter !== "OLD-OBJECT", label + " first ensure does not relink old objects")
      check(run.cacheAfter !== "STALE-CACHE-SO", label + " first ensure does not reuse stale cache .so")
      check(run.stderr1.indexOf("not relinking stale objects") !== -1, label + " first ensure force-rebuilds objects")
      check(run.status2 === 0, label + " second ensure exits 0")
      check(run.stdout2.indexOf("STATUS=ok") !== -1, label + " second ensure STATUS=ok: " + run.stdout2)
      check(run.make2.length > run.make1.length, label + " second ensure cannot reuse restored stale bytes without rebuilding")
      check(run.after2 === "BUILT-SO", label + " second ensure session .so is newly built, not restored stale")
      check(run.obj2 !== "OLD-OBJECT-AGAIN", label + " second ensure does not relink restored old objects")
    }

    assertMismatch(a, kind + " run1")
    assertMismatch(b, kind + " run2")
    check(
      (a.stdout1.indexOf("STATUS=ok") !== -1) === (b.stdout1.indexOf("STATUS=ok") !== -1) &&
        (a.make1.length > 0) === (b.make1.length > 0) &&
        (a.after1 === "BUILT-SO") === (b.after1 === "BUILT-SO") &&
        (a.make2.length > a.make1.length) === (b.make2.length > b.make1.length) &&
        (a.after2 === "BUILT-SO") === (b.after2 === "BUILT-SO"),
      kind + " both runs agree"
    )
  }
}

function runAbiLoadHashMismatchOnce() {
  const hyprSrc = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-abi-load-"))
  fs.mkdirSync(path.join(hyprSrc, "src"), { recursive: true })
  const srcFile = path.join(hyprSrc, "src", "main.cpp")
  fs.writeFileSync(srcFile, "// plugin source\n")
  const past = new Date(Date.now() - 86400000)
  fs.utimesSync(srcFile, past, past)
  const h = createHarness({
    hyprSrc: hyprSrc,
    makeExit: 0,
    loadExit: 1,
    loadMessage: "[shiny-border] version mismatch",
  })
  try {
    plantStaleSo(h.sessionSo, "STALE-SESSION-SO")
    const r1 = runEnsure(h, "{}")
    const make1 = readLog(h.makeLog)
    const exists1 = fs.existsSync(h.sessionSo)
    const flag1 = fs.existsSync(h.abiMismatch)
    const r2 = runEnsure(h, "{}")
    const make2 = readLog(h.makeLog)
    const exists2 = fs.existsSync(h.sessionSo)
    return {
      status1: r1.status,
      stdout1: String(r1.stdout || ""),
      stderr1: String(r1.stderr || ""),
      log1: readLog(h.logPath),
      make1: make1,
      exists1: exists1,
      flag1: flag1,
      status2: r2.status,
      stdout2: String(r2.stdout || ""),
      make2: make2,
      exists2: exists2,
    }
  } finally {
    stopHarness(h)
    fs.rmSync(hyprSrc, { recursive: true, force: true })
  }
}

function checkAbiLoadHashMismatch() {
  const a = runAbiLoadHashMismatchOnce()
  const b = runAbiLoadHashMismatchOnce()

  function summarize(run, label) {
    const msg =
      label +
      " status1=" +
      run.status1 +
      " STATUS=" +
      statusLines(run.stdout1).join(",") +
      " make1=" +
      (run.make1.length > 0) +
      " sessionGone1=" +
      (!run.exists1) +
      " flag=" +
      run.flag1 +
      " status2=" +
      run.status2 +
      " make2=" +
      (run.make2.length > 0) +
      " sessionGone2=" +
      (!run.exists2)
    note("abi", msg)
    return msg
  }
  summarize(a, "load-mismatch run1")
  summarize(b, "load-mismatch run2")

  function assertFail(run, label) {
    check(run.status1 === 0, label + " first ensure exits 0")
    check(run.stdout1.indexOf("STATUS=load-failed") !== -1, label + " first ensure STATUS=load-failed: " + run.stdout1)
    check(run.make1.length === 0, label + " first ensure reused the session .so (load then hash-mismatch)")
    check(logHas(run.log1, "plugin load"), label + " first ensure attempted plugin load")
    check(!run.exists1, label + " first ensure deleted SESSION_SO after hash-mismatch")
    check(run.flag1, label + " first ensure recorded hash-mismatch")
    check(run.status2 === 0, label + " second ensure exits 0")
    check(run.stdout2.indexOf("STATUS=load-failed") !== -1, label + " second ensure STATUS=load-failed")
    check(run.make2.length > 0, label + " second ensure cannot reuse deleted session .so; rebuilds")
    check(!run.exists2, label + " second ensure deleted SESSION_SO again after hash-mismatch")
  }
  assertFail(a, "load-mismatch run1")
  assertFail(b, "load-mismatch run2")
  check(
    (a.stdout1.indexOf("STATUS=load-failed") !== -1) === (b.stdout1.indexOf("STATUS=load-failed") !== -1) &&
      a.exists1 === b.exists1 &&
      (a.make2.length > 0) === (b.make2.length > 0) &&
      a.exists2 === b.exists2,
    "both load-mismatch runs agree"
  )
}

function checkMakefileCompilerRebuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hypr-make-abi-"))
  const buildDir = path.join(dir, "build")
  const binDir = path.join(dir, "bin")
  const log = path.join(dir, "cxx.log")
  fs.mkdirSync(binDir)
  const cxx = path.join(binDir, "cxx-stub")
  fs.writeFileSync(
    cxx,
    [
      "#!/usr/bin/env bash",
      "LOG=" + JSON.stringify(log),
      "VER=${STUB_CXX_VER:-1}",
      'echo "$*" >> "$LOG"',
      'if [[ $1 == -dumpmachine ]]; then echo x86_64-test-linux-gnu; exit 0; fi',
      'if [[ $1 == -dumpversion ]]; then echo "$VER"; exit 0; fi',
      'out=""; compile=0; mf=""; prev=""',
      'for a in "$@"; do',
      '  if [[ $prev == -o ]]; then out="$a"; fi',
      '  if [[ $prev == -MF ]]; then mf="$a"; fi',
      '  if [[ $a == -c ]]; then compile=1; fi',
      '  prev="$a"',
      "done",
      'if [[ -z $out ]]; then echo "cxx-stub: no -o" >&2; exit 1; fi',
      'mkdir -p "$(dirname "$out")"',
      "if [[ $compile -eq 1 ]]; then",
      '  echo COMPILE >> "$LOG"',
      '  printf "obj\\n" > "$out"',
      '  if [[ -n $mf ]]; then',
      '    mkdir -p "$(dirname "$mf")"',
      '    printf "%s:\\n" "$out" > "$mf"',
      "  fi",
      "else",
      '  echo LINK >> "$LOG"',
      '  printf "so\\n" > "$out"',
      "fi",
      "exit 0",
    ].join("\n") + "\n"
  )
  fs.chmodSync(cxx, 0o755)

  function compileCount() {
    return (readLog(log).match(/^COMPILE$/gm) || []).length
  }

  function runMake(ver) {
    return spawnSync(
      "make",
      ["-C", path.join(root, "hypr"), "all", "BUILD_DIR=" + buildDir, "CXX=" + cxx],
      {
        encoding: "utf8",
        env: Object.assign({}, process.env, { STUB_CXX_VER: String(ver) }),
        timeout: 30000,
      }
    )
  }

  try {
    const r1 = runMake(1)
    check(r1.status === 0, "makefile first build exits 0: " + (r1.stderr || r1.stdout || ""))
    const c1 = compileCount()
    check(c1 > 0, "makefile first build compiles objects: " + c1)
    note("abi", "makefile first compileCount=" + c1)

    const r2 = runMake(1)
    check(r2.status === 0, "makefile second same-compiler build exits 0: " + (r2.stderr || r2.stdout || ""))
    const c2 = compileCount()
    check(c2 === c1, "makefile same compiler does not recompile: c1=" + c1 + " c2=" + c2)

    const hdr = path.join(dir, "hyprland-version.h")
    fs.writeFileSync(hdr, "/* fixture header */\n")
    const objDir = path.join(buildDir, "obj")
    const dFiles = fs.existsSync(objDir)
      ? fs.readdirSync(objDir).filter((n) => n.endsWith(".d"))
      : []
    check(dFiles.length > 0, "makefile wrote .d header-dep files")
    if (dFiles.length > 0) {
      const dPath = path.join(objDir, dFiles[0])
      const objFile = dPath.slice(0, -2) + ".o"
      fs.writeFileSync(dPath, objFile + ": " + hdr + "\n")
      const future = new Date(Date.now() + 86400000)
      fs.utimesSync(hdr, future, future)
      const rH = runMake(1)
      check(rH.status === 0, "makefile header-mtime rebuild exits 0: " + (rH.stderr || rH.stdout || ""))
      const cH = compileCount()
      check(cH > c2, "makefile header mtime change recompiles, not relink-only: " + c2 + " -> " + cH)
      note("abi", "makefile header-mtime compileCount=" + cH)
    }

    const cBeforeCompiler = compileCount()
    const r3 = runMake(2)
    check(r3.status === 0, "makefile compiler-id change exits 0: " + (r3.stderr || r3.stdout || ""))
    const c3 = compileCount()
    check(c3 > cBeforeCompiler, "makefile compiler-id change recompiles objects, not relink-only: " + cBeforeCompiler + " -> " + c3)
    note("abi", "makefile compiler-id compileCount=" + c3)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeEvidence() {
  const dir = process.env.HYPR_SESSION_EVIDENCE_DIR
  if (!dir)
    return
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "teardown-persist.log"), evidenceChunks.teardown.join("\n") + "\n")
  fs.writeFileSync(path.join(dir, "ensure-tree.log"), evidenceChunks.ensure.join("\n") + "\n")
  fs.writeFileSync(path.join(dir, "teardown-ensure-lock.log"), evidenceChunks.lock.join("\n") + "\n")
  fs.writeFileSync(
    path.join(dir, "ensure-hot-reload-load-failed.log"),
    evidenceChunks.hotReload.join("\n") + "\n"
  )
  fs.writeFileSync(path.join(dir, "ensure-abi-freshness.log"), evidenceChunks.abi.join("\n") + "\n")
}

checkScriptShape()
checkInstallSessionSo()
checkWaitPluginGone()
checkTeardownPersist()
checkEnsureTree()
checkEnsureHotReloadLoadFailed()
checkTeardownEnsureLock()
checkAbiHelperPredicate()
checkAbiEnsureMismatch()
checkAbiLoadHashMismatch()
checkMakefileCompilerRebuild()
writeEvidence()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
