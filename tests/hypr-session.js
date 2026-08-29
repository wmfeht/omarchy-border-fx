#!/usr/bin/env node
// Compositor-free tests for hypr-session.sh / reinstall order / hypr-ensure
// install path. Does not talk to a live Hyprland.

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")

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
    !/cp -f "\$src" "\$SESSION_SO"/.test(ensure),
    "hypr-ensure does not cp -f onto the live session .so"
  )
  const unloadCall = ensure.indexOf("if unload_session_so")
  const copyCall = ensure.indexOf("copy_session_so \"$BUILD_DIR")
  check(
    unloadCall !== -1 && copyCall !== -1 && unloadCall < copyCall,
    "hypr-ensure unloads and waits before replacing the session .so"
  )

  check(teardown.indexOf("hypr-session.sh") !== -1, "hypr-teardown sources hypr-session.sh")
  check(teardown.indexOf("wait_plugin_gone") !== -1, "hypr-teardown waits for unmap")

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

checkScriptShape()
checkInstallSessionSo()
checkWaitPluginGone()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
