#!/usr/bin/env bash
# Provision Hyprland v0.56.2 development headers (+ the hypr*/aquamarine and
# Wayland-stack dependencies they need) so the compositor plugin can be
# COMPILE-tested with `mise run hypr-build` on Debian/Ubuntu.
#
# This does NOT let you load or run the plugin: the .so is ABI-checked against
# the live compositor at load (PLUGIN_INIT), and there is no Wayland/Hyprland
# session on a headless VM. It only catches compile/link errors.
#
# Ubuntu 24.04 ships several libs older than Hyprland v0.56.2 requires
# (cmake, wayland, wayland-protocols, xkbcommon, libinput), so those are built
# from source into /usr/local alongside the hypr* ecosystem. Everything is
# pinned to the versions Hyprland v0.56.2 was released against and each step is
# idempotent (skips when already installed). Target: DEVELOPMENT.md's
# "headers in /usr/include/hyprland".
set -euo pipefail

PREFIX_LOCAL=/usr/local
BUILD_DIR=${HYPR_HEADERS_BUILD_DIR:-/opt/hypr-build}
CMAKE_VER=3.31.6

export PKG_CONFIG_PATH="$PREFIX_LOCAL/lib/x86_64-linux-gnu/pkgconfig:$PREFIX_LOCAL/lib/pkgconfig:$PREFIX_LOCAL/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export CMAKE_PREFIX_PATH="$PREFIX_LOCAL"
export CC=gcc-14 CXX=g++-14

# Already provisioned? (headers present and pkg-config can resolve hyprland)
if [ -d /usr/include/hyprland/src ] && pkg-config --exists hyprland 2>/dev/null; then
  echo "Hyprland headers already present ($(pkg-config --modversion hyprland)); skipping."
  exit 0
fi

echo "== Installing Debian/Ubuntu build dependencies =="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  build-essential g++-14 ninja-build meson pkg-config git cpio \
  autoconf automake libtool xcb-proto python3-xcbgen xorg-sgml-doctools xutils-dev \
  bison flex libffi-dev libexpat1-dev libxml2-dev libreadline-dev \
  libpixman-1-dev libdrm-dev libcairo2-dev libpango1.0-dev \
  libgbm-dev libgles2-mesa-dev libgles-dev libegl-dev libglvnd-dev \
  libglib2.0-dev uuid-dev \
  libseat-dev libdisplay-info-dev liblcms2-dev libtomlplusplus-dev \
  libzip-dev librsvg2-dev libmagic-dev libspng-dev libjpeg-turbo8-dev libwebp-dev \
  libmtdev-dev libevdev-dev libwacom-dev libgudev-1.0-dev libudev-dev \
  hwdata libpugixml-dev libxkbregistry-dev \
  libre2-dev libmuparser-dev libcanberra-dev libeis-dev \
  glslang-dev glslang-tools libxcursor-dev \
  libxcb1-dev libxcb-util-dev libxcb-render0-dev libxcb-xfixes0-dev \
  libxcb-icccm4-dev libxcb-composite0-dev libxcb-res0-dev

# Newer cmake (Hyprland needs >= 3.30; only used to build the stack below).
CMAKE=cmake
if ! cmake --version 2>/dev/null | grep -qE '3\.(3[0-9]|[4-9][0-9])|[4-9]\.'; then
  if [ ! -x /opt/cmake/bin/cmake ]; then
    curl -fsSL "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VER}/cmake-${CMAKE_VER}-linux-x86_64.tar.gz" -o /tmp/cmake.tgz
    sudo mkdir -p /opt/cmake && sudo tar -xzf /tmp/cmake.tgz -C /opt/cmake --strip-components=1
  fi
  CMAKE=/opt/cmake/bin/cmake
  export PATH=/opt/cmake/bin:$PATH
fi

sudo mkdir -p "$BUILD_DIR" && sudo chown "$(id -u):$(id -g)" "$BUILD_DIR"
cd "$BUILD_DIR"

have() { PKG_CONFIG_PATH="$PKG_CONFIG_PATH" pkg-config --exists "$1" 2>/dev/null; }
clone_tag() { local url=$1 tag=$2 dir=$3; [ -d "$dir/.git" ] || git clone --depth 1 -b "$tag" "$url" "$dir"; }

meson_install() { # dir  extra-setup-args...
  local dir=$1; shift
  cd "$BUILD_DIR/$dir"
  [ -d build ] || meson setup build --prefix="$PREFIX_LOCAL" "$@"
  ninja -C build
  sudo ninja -C build install
  cd "$BUILD_DIR"
}
cmake_install() { # dir
  local dir=$1
  cd "$BUILD_DIR/$dir"
  rm -rf build
  "$CMAKE" -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$PREFIX_LOCAL" \
    -DCMAKE_C_COMPILER=gcc-14 -DCMAKE_CXX_COMPILER=g++-14
  ninja -C build
  sudo -E ninja -C build install
  cd "$BUILD_DIR"
}

echo "== Wayland stack (newer than Ubuntu 24.04 ships) =="
have wayland-server || { clone_tag https://gitlab.freedesktop.org/wayland/wayland.git 1.23.1 wayland; \
  meson_install wayland -Ddocumentation=false -Dtests=false -Ddtd_validation=false; }
have wayland-protocols || { clone_tag https://gitlab.freedesktop.org/wayland/wayland-protocols.git 1.49 wayland-protocols; \
  meson_install wayland-protocols -Dtests=false; }
pkg-config --atleast-version=1.11.0 xkbcommon 2>/dev/null || { clone_tag https://github.com/xkbcommon/libxkbcommon.git xkbcommon-1.11.0 libxkbcommon; \
  meson_install libxkbcommon -Denable-docs=false -Denable-x11=false -Denable-tools=false; }
pkg-config --atleast-version=1.29 libinput 2>/dev/null || { clone_tag https://gitlab.freedesktop.org/libinput/libinput.git 1.29.0 libinput; \
  meson_install libinput -Ddocumentation=false -Dtests=false -Ddebug-gui=false; }

echo "== xcb-util-errors (not packaged on Ubuntu) =="
have xcb-errors || { [ -d xcb-util-errors/.git ] || git clone --recursive https://gitlab.freedesktop.org/xorg/lib/libxcb-errors.git xcb-util-errors; \
  cd xcb-util-errors; NOCONFIGURE=1 ./autogen.sh; ./configure --prefix="$PREFIX_LOCAL"; make; sudo make install; cd "$BUILD_DIR"; }

echo "== Lua 5.5 (required by Hyprland; not packaged) =="
if ! have lua5.5; then
  curl -fsSL https://www.lua.org/ftp/lua-5.5.0.tar.gz -o /tmp/lua.tgz
  rm -rf lua && mkdir lua && tar -xzf /tmp/lua.tgz -C lua --strip-components=1
  cd lua && make linux MYCFLAGS="-fPIC" -j"$(nproc)" && sudo make install INSTALL_TOP="$PREFIX_LOCAL"
  sudo mkdir -p "$PREFIX_LOCAL/lib/pkgconfig"
  sudo tee "$PREFIX_LOCAL/lib/pkgconfig/lua5.5.pc" >/dev/null <<PC
prefix=$PREFIX_LOCAL
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: Lua
Description: Lua language engine
Version: 5.5.0
Libs: -L\${libdir} -llua -lm -ldl
Cflags: -I\${includedir}
PC
  cd "$BUILD_DIR"
fi

echo "== hypr* ecosystem (versions matching Hyprland v0.56.2) =="
have hyprwayland-scanner || { clone_tag https://github.com/hyprwm/hyprwayland-scanner.git v0.4.5 hyprwayland-scanner; cmake_install hyprwayland-scanner; }
have hyprutils    || { clone_tag https://github.com/hyprwm/hyprutils.git    v0.14.0 hyprutils;    cmake_install hyprutils; }
have hyprlang     || { clone_tag https://github.com/hyprwm/hyprlang.git     v0.6.7  hyprlang;     cmake_install hyprlang; }
have hyprgraphics || { clone_tag https://github.com/hyprwm/hyprgraphics.git v0.5.1  hyprgraphics; cmake_install hyprgraphics; }
if ! have hyprcursor; then
  clone_tag https://github.com/hyprwm/hyprcursor.git v0.1.7 hyprcursor
  # newer libstdc++ needs an explicit <fstream> include in the CLI util
  f="$BUILD_DIR/hyprcursor/hyprcursor-util/src/main.cpp"
  [ -f "$f" ] && ! grep -q '#include <fstream>' "$f" && sed -i 's/#include "meta.hpp"/#include "meta.hpp"\n#include <fstream>/' "$f"
  cmake_install hyprcursor
fi
if ! have aquamarine; then
  # aquamarine tag v0.9.3 predates hyprutils' explicit operator bool; use the
  # exact rev Hyprland v0.56.2 pins. Build only the library (its test exes
  # hardcode the system libinput and are not needed for headers).
  [ -d aquamarine/.git ] || git clone https://github.com/hyprwm/aquamarine.git aquamarine
  cd aquamarine && git checkout -q 1a10fe26a9f7
  rm -rf build
  "$CMAKE" -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX_LOCAL" \
    -DCMAKE_C_COMPILER=gcc-14 -DCMAKE_CXX_COMPILER=g++-14
  ninja -C build aquamarine
  sudo -E "$CMAKE" --install build
  cd "$BUILD_DIR"
fi
have hyprland-protocols || { clone_tag https://github.com/hyprwm/hyprland-protocols.git v0.7.0 hyprland-protocols; \
  meson_install hyprland-protocols; }

echo "== Hyprland v0.56.2 headers =="
clone_tag https://github.com/hyprwm/Hyprland.git v0.56.2 Hyprland
cd Hyprland
git submodule update --init --recursive
# hyprctl needs hyprwire/readline and is not part of the installed headers
sed -i 's/^add_subdirectory(hyprctl)/# add_subdirectory(hyprctl) # headers-only build/' CMakeLists.txt
"$CMAKE" --no-warn-unused-cli -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=gcc-14 -DCMAKE_CXX_COMPILER=g++-14 -DNO_HYPRPM=true -B build -G Ninja
"$CMAKE" --build ./build --config Release --target generate-protocol-headers
sudo env "PATH=$PATH" make installheaders PREFIX=/usr
# installheaders bakes the CMAKE_INSTALL_PREFIX (/usr/local) into the .pc, but
# the headers were copied to /usr — point the .pc Cflags at the real location.
sudo sed -i 's|^prefix=/usr/local/include|prefix=/usr/include|' /usr/share/pkgconfig/hyprland.pc

echo ""
echo "Hyprland headers installed: $(PKG_CONFIG_PATH=$PKG_CONFIG_PATH pkg-config --modversion hyprland)"
echo "Run: mise run hypr-build   # compiles hypr/hypr-shiny-border.so"
