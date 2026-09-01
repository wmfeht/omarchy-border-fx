// Locate (building on demand) the debug `border-fx` binary for the
// compositor-free test suites. `BORDER_FX_BIN` skips the build.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")

const root = path.resolve(__dirname, "..")
let cached = null

function cargo() {
  const candidates = [
    process.env.CARGO,
    "cargo",
    path.join(process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"), "bin", "cargo"),
    "/usr/bin/cargo",
  ].filter(Boolean)
  for (const c of candidates) {
    const probe = spawnSync(c, ["--version"], { encoding: "utf8" })
    if (probe.status === 0)
      return c
  }
  throw new Error("cargo not found; install rust or set BORDER_FX_BIN")
}

function bin() {
  if (cached)
    return cached
  if (process.env.BORDER_FX_BIN) {
    cached = process.env.BORDER_FX_BIN
    return cached
  }
  const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, "cli", "target")
  const built = path.join(targetDir, "debug", "border-fx")
  const r = spawnSync(cargo(), ["build", "--quiet", "--manifest-path", path.join(root, "cli", "Cargo.toml")], {
    encoding: "utf8",
    stdio: ["ignore", "inherit", "inherit"],
    env: Object.assign({}, process.env, { CARGO_TARGET_DIR: targetDir }),
  })
  if (r.status !== 0)
    throw new Error("cargo build of cli/ failed")
  if (!fs.existsSync(built))
    throw new Error("cargo build produced no binary at " + built)
  cached = built
  return cached
}

// spawnSync the CLI. `opts.env` replaces the environment when given.
function run(args, opts) {
  opts = opts || {}
  return spawnSync(bin(), args, Object.assign({ encoding: "utf8", timeout: 30000 }, opts))
}

module.exports = { root, bin, run }
