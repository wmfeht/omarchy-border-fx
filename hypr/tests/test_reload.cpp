#include "../src/runtime.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

static int g_fails = 0;

#define CHECK(cond)                                                                                                    \
    do {                                                                                                               \
        if (!(cond)) {                                                                                                 \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                                       \
            g_fails++;                                                                                                 \
        }                                                                                                              \
    } while (0)

static std::string testsDir() {
    std::string       file     = __FILE__;
    const auto        slash    = file.find_last_of('/');
    const std::string dir      = (slash == std::string::npos) ? std::string(".") : file.substr(0, slash);
    return dir;
}

static std::string repoRoot() {
    return std::filesystem::weakly_canonical(testsDir() + "/..").string();
}

static std::string readFile(const std::string& path) {
    std::ifstream in(path);
    if (!in)
        return {};
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

static void writeFile(const std::string& path, const std::string& body) {
    std::ofstream out(path);
    out << body;
}

static int countNeedle(const std::string& hay, const std::string& needle) {
    int    n = 0;
    size_t p = 0;
    while ((p = hay.find(needle, p)) != std::string::npos) {
        n++;
        p += needle.size();
    }
    return n;
}

static int runCmd(const std::string& cmd, std::string& output) {
    output.clear();
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe)
        return 127;
    char buf[4096];
    while (std::fgets(buf, sizeof(buf), pipe))
        output += buf;
    const int st = pclose(pipe);
    if (st == -1)
        return 127;
    if (WIFEXITED(st))
        return WEXITSTATUS(st);
    return 1;
}

static const char* kStatePath = "/tmp/hypr-shiny-border.lastso";

struct StateGuard {
    bool        existed = false;
    std::string orig;

    StateGuard() {
        existed = std::filesystem::exists(kStatePath);
        if (existed)
            orig = readFile(kStatePath);
    }

    ~StateGuard() {
        if (existed)
            writeFile(kStatePath, orig);
        else
            std::filesystem::remove(kStatePath);
    }
};

struct StubHyprctl {
    std::string dir;
    std::string record;
    std::string listFile;
    std::string instancesFile;
    std::string pluginctl;

    bool init() {
        std::string tmpl = "/tmp/shiny-reload-XXXXXX";
        std::vector<char> buf(tmpl.begin(), tmpl.end());
        buf.push_back('\0');
        char* made = mkdtemp(buf.data());
        if (!made)
            return false;
        dir            = made;
        record         = dir + "/record";
        listFile       = dir + "/plugin_list";
        instancesFile  = dir + "/instances.json";
        pluginctl      = repoRoot() + "/scripts/pluginctl.sh";
        writeFile(record, "");
        writeFile(listFile, "no plugins loaded\n");
        writeFile(instancesFile, R"([
  {"instance": "live", "time": 1, "pid": 1, "wl_socket": "wayland-0"},
  {"instance": "nest", "time": 2, "pid": 2, "wl_socket": "wayland-1"}
]
)");
        const std::string stubPath = dir + "/hyprctl";
        writeFile(stubPath, R"STUB(#!/usr/bin/env bash
set -euo pipefail
log="${HYPRCTL_RECORD:?}"
printf '%s\n' "$*" >>"$log"

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -j) shift ;;
    -i|--instance) shift; shift ;;
    *) args+=("$1"); shift ;;
  esac
done

if [[ ${#args[@]} -ge 1 && "${args[0]}" == "instances" ]]; then
  cat "${HYPRCTL_INSTANCES:?}"
  exit 0
fi
if [[ ${#args[@]} -ge 2 && "${args[0]}" == "plugin" && "${args[1]}" == "list" ]]; then
  cat "${HYPRCTL_PLUGIN_LIST:?}"
  exit 0
fi
if [[ ${#args[@]} -ge 2 && "${args[0]}" == "plugin" && "${args[1]}" == "load" ]]; then
  exit 0
fi
if [[ ${#args[@]} -ge 2 && "${args[0]}" == "plugin" && "${args[1]}" == "unload" ]]; then
  if [[ "${HYPRCTL_UNLOAD_FAIL:-}" == "1" ]]; then
    exit 1
  fi
  exit 0
fi
exit 0
)STUB");
        if (::chmod(stubPath.c_str(), 0755) != 0)
            return false;
        return std::filesystem::exists(pluginctl);
    }

    ~StubHyprctl() {
        if (!dir.empty()) {
            std::error_code ec;
            std::filesystem::remove_all(dir, ec);
        }
    }

    void setList(const std::string& body) { writeFile(listFile, body); }
    void clearRecord() { writeFile(record, ""); }
    std::string recorded() const { return readFile(record); }

    int run(const std::string& subcmd, const std::string& extraEnv, std::string& output) {
        const std::string cmd = "env -u SHINY_LIVE -u SHINY_INSTANCE " + extraEnv + " PATH=" + dir +
                                ":\"$PATH\" HYPRCTL_RECORD='" + record + "' HYPRCTL_PLUGIN_LIST='" + listFile +
                                "' HYPRCTL_INSTANCES='" + instancesFile + "' '" + pluginctl + "' " + subcmd + " 2>&1";
        return runCmd(cmd, output);
    }
};

static void checkResolvedBorderSize() {
    // plugin value >= 0 wins, including 0 (no ring).
    CHECK(shinyResolvedBorderSize(3, 2) == 3);
    CHECK(shinyResolvedBorderSize(0, 7) == 0);
    CHECK(shinyResolvedBorderSize(20, 1) == 20);
    // -1 follows general:border_size.
    CHECK(shinyResolvedBorderSize(-1, 2) == 2);
    CHECK(shinyResolvedBorderSize(-1, 0) == 0);
    CHECK(shinyResolvedBorderSize(-1, 8) == 8);
}

static void checkPluginctl() {
    StateGuard     state;
    StubHyprctl    stub;
    CHECK(stub.init());
    if (stub.dir.empty())
        return;

    // Drive the real script, not a copy.
    CHECK(stub.pluginctl == repoRoot() + "/scripts/pluginctl.sh");
    CHECK(std::filesystem::exists(stub.pluginctl));

    const std::string so = repoRoot() + "/hypr-shiny-border.so";
    CHECK(std::filesystem::exists(so));

    std::string out;
    const std::string stale = "/tmp/hypr-shiny-border-stale.so";
    writeFile(stale, "stale");

    // Name already listed (any path) → non-zero, no plugin load, no STATE write.
    // Refuse must not sweep leftover /tmp copies a retry still needs.
    writeFile(kStatePath, "KEEP\n");
    stub.clearRecord();
    stub.setList("Plugin hypr-shiny-border by wmfeht:\n\tHandle: 0x1\n\tVersion: 0.1.0\n"
                 "\tDescription: Gradient window border with a directional highlight\n");
    int rc = stub.run("load", "", out);
    CHECK(rc != 0);
    CHECK(out.find("already loaded") != std::string::npos);
    CHECK(countNeedle(stub.recorded(), "plugin load") == 0);
    CHECK(readFile(kStatePath) == "KEEP\n");
    CHECK(std::filesystem::exists(stale));

    // Listed only via a different path still refuses.
    stub.clearRecord();
    stub.setList("loaded: /var/lib/hypr/hypr-shiny-border.so\n");
    rc = stub.run("load", "", out);
    CHECK(rc != 0);
    CHECK(countNeedle(stub.recorded(), "plugin load") == 0);
    CHECK(std::filesystem::exists(stale));

    // Name not listed → sweep stale copies, copy under /tmp/hypr-shiny-border-*.so,
    // exactly one plugin load.
    stub.clearRecord();
    stub.setList("Plugin hyprbars by Vaxry:\n\tHandle: 0x2\n\tVersion: 1.0\n\tDescription: bars\n");
    rc = stub.run("load", "", out);
    CHECK(rc == 0);
    CHECK(countNeedle(stub.recorded(), "plugin load") == 1);
    const auto rec  = stub.recorded();
    const auto loadAt = rec.find("plugin load ");
    CHECK(loadAt != std::string::npos);
    auto destBegin = loadAt + std::strlen("plugin load ");
    auto destEnd   = rec.find('\n', destBegin);
    const std::string dest = rec.substr(destBegin, destEnd == std::string::npos ? std::string::npos : destEnd - destBegin);
    CHECK(dest.find("/tmp/hypr-shiny-border-") == 0);
    CHECK(dest.size() > std::strlen("/tmp/hypr-shiny-border-.so"));
    CHECK(dest.ends_with(".so"));
    CHECK(std::filesystem::exists(dest));
    CHECK(std::filesystem::file_size(dest) == std::filesystem::file_size(so));
    CHECK(readFile(kStatePath).find("/tmp/hypr-shiny-border-") != std::string::npos);
    CHECK(!std::filesystem::exists(stale));
    std::filesystem::remove(dest);

    // reload is unload then load.
    writeFile(kStatePath, "/tmp/shiny-old-copy.so\n");
    stub.clearRecord();
    stub.setList("no plugins loaded\n");
    rc = stub.run("reload", "", out);
    CHECK(rc == 0);
    const auto rec2 = stub.recorded();
    CHECK(countNeedle(rec2, "plugin unload") == 1);
    CHECK(countNeedle(rec2, "plugin load") == 1);
    CHECK(rec2.find("plugin unload") < rec2.find("plugin load"));
    CHECK(rec2.find("/tmp/shiny-old-copy.so") != std::string::npos);
    const auto load2 = rec2.find("plugin load ");
    CHECK(load2 != std::string::npos);
    auto d2b = load2 + std::strlen("plugin load ");
    auto d2e = rec2.find('\n', d2b);
    const std::string dest2 = rec2.substr(d2b, d2e == std::string::npos ? std::string::npos : d2e - d2b);
    if (std::filesystem::exists(dest2))
        std::filesystem::remove(dest2);

    // Unload leaves the name listed → following load still refuses, no second copy.
    writeFile(kStatePath, "/tmp/shiny-old-copy.so\n");
    stub.clearRecord();
    stub.setList("Plugin hypr-shiny-border by wmfeht:\n\tHandle: 0x1\n");
    rc = stub.run("reload", "HYPRCTL_UNLOAD_FAIL=1", out);
    CHECK(rc != 0);
    const auto rec3 = stub.recorded();
    CHECK(countNeedle(rec3, "plugin unload") == 1);
    CHECK(countNeedle(rec3, "plugin load") == 0);
    CHECK(out.find("already loaded") != std::string::npos);
    CHECK(readFile(kStatePath).find("/tmp/shiny-old-copy.so") != std::string::npos);

    // Failed unload keeps $STATE so a retry can name the /tmp copy.
    writeFile(kStatePath, "/tmp/shiny-old-copy.so\n");
    stub.clearRecord();
    stub.setList("Plugin hypr-shiny-border by wmfeht:\n\tHandle: 0x1\n");
    rc = stub.run("unload", "HYPRCTL_UNLOAD_FAIL=1", out);
    CHECK(rc != 0);
    CHECK(countNeedle(stub.recorded(), "plugin unload") == 1);
    CHECK(readFile(kStatePath).find("/tmp/shiny-old-copy.so") != std::string::npos);

    // Retry after a failed unload: same $STATE path, then $STATE is gone.
    stub.clearRecord();
    stub.setList("no plugins loaded\n");
    rc = stub.run("unload", "", out);
    CHECK(rc == 0);
    CHECK(countNeedle(stub.recorded(), "plugin unload") == 1);
    CHECK(stub.recorded().find("/tmp/shiny-old-copy.so") != std::string::npos);
    CHECK(!std::filesystem::exists(kStatePath));

    // Successful unload removes $STATE.
    writeFile(kStatePath, "/tmp/shiny-old-copy.so\n");
    stub.clearRecord();
    stub.setList("Plugin hypr-shiny-border by wmfeht:\n\tHandle: 0x1\n");
    rc = stub.run("unload", "", out);
    CHECK(rc == 0);
    CHECK(!std::filesystem::exists(kStatePath));

    // Unload reported failure but the name is gone → drop the stale path.
    writeFile(kStatePath, "/tmp/shiny-old-copy.so\n");
    stub.clearRecord();
    stub.setList("no plugins loaded\n");
    rc = stub.run("unload", "HYPRCTL_UNLOAD_FAIL=1", out);
    CHECK(rc == 0);
    CHECK(!std::filesystem::exists(kStatePath));

    // Instance 0 without SHINY_LIVE=1 still refuses. No plugin load, no /tmp sweep.
    writeFile(stale, "stale");
    stub.clearRecord();
    stub.setList("no plugins loaded\n");
    rc = stub.run("load", "SHINY_INSTANCE=0", out);
    CHECK(rc != 0);
    CHECK(out.find("refusing to touch the live Hyprland session") != std::string::npos);
    CHECK(countNeedle(stub.recorded(), "plugin load") == 0);
    CHECK(stub.recorded().empty());
    CHECK(std::filesystem::exists(stale));
    std::filesystem::remove(stale);
}

int main() {
    checkResolvedBorderSize();
    checkPluginctl();

    if (g_fails) {
        std::fprintf(stderr, "%d checks failed\n", g_fails);
        return 1;
    }
    std::puts("ok");
    return 0;
}
