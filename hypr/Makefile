# Build against the Hyprland that pkg-config finds (Omarchy: /usr).
# hyprpm.toml runs `make all` with PKG_CONFIG_PATH pointing at hyprpm's headers.
# --no-gnu-unique is required so the plugin can actually unload.

PLUGIN := hypr-shiny-border

# In-tree for hyprpm / nest. Omarchy enable sets BUILD_DIR to
# XDG_CACHE_HOME so obj/ and the .so do not land in the plugin checkout
# (omarchy-shell rescans that folder on any save).
BUILD_DIR ?= .
OBJ_DIR   := $(BUILD_DIR)/obj
SO        := $(BUILD_DIR)/$(PLUGIN).so

CXX      ?= g++
PKG      := hyprland pixman-1 libdrm pangocairo
CXXFLAGS ?= -O2 -g
override CXXFLAGS += -std=gnu++26 -fPIC -fno-gnu-unique
override CXXFLAGS += -fdiagnostics-color=always -DWLR_USE_UNSTABLE
override CXXFLAGS += $(shell pkg-config --cflags $(PKG))
LDFLAGS  ?=
override LDFLAGS  += -shared
LIBS     := $(shell pkg-config --libs $(PKG))

SRC := $(wildcard src/*.cpp)
OBJ := $(patsubst src/%.cpp,$(OBJ_DIR)/%.o,$(SRC))

TEST_TEARDOWN := tests/test_teardown
TEST_RUNTIME  := tests/test_runtime
TEST_RELOAD   := tests/test_reload
TEST_VISUAL   := tests/test_visual
DUMP_SHIMMER  := tests/dump_shimmer
TESTS         := $(TEST_TEARDOWN) $(TEST_RUNTIME) $(TEST_RELOAD) $(TEST_VISUAL) $(DUMP_SHIMMER)

# Compiler identity objects were built with. Recipe is forced so a different
# $(CXX) -dumpmachine/-dumpversion rewrites the stamp and rebuilds .o files.
COMPILER_ID    := $(shell $(CXX) -dumpmachine 2>/dev/null)-$(shell $(CXX) -dumpversion 2>/dev/null)
COMPILER_STAMP := $(OBJ_DIR)/.compiler-id
DEP            := $(OBJ:.o=.d)

.PHONY: all clean clangd test test-logic test-full _hypr_compiler_id

all: $(SO)

$(COMPILER_STAMP): _hypr_compiler_id
	@mkdir -p "$(OBJ_DIR)"
	@printf '%s\n' "$(COMPILER_ID)" > "$(COMPILER_STAMP).tmp"
	@if [ ! -f "$(COMPILER_STAMP)" ] || ! cmp -s "$(COMPILER_STAMP).tmp" "$(COMPILER_STAMP)"; then \
	  mv -f "$(COMPILER_STAMP).tmp" "$(COMPILER_STAMP)"; \
	else \
	  rm -f "$(COMPILER_STAMP).tmp"; \
	fi

$(OBJ_DIR)/%.o: src/%.cpp src/*.hpp $(COMPILER_STAMP)
	@mkdir -p "$(OBJ_DIR)"
	$(CXX) $(CXXFLAGS) -MD -MP -MF $(OBJ_DIR)/$*.d -c -o $@ $<

$(SO): $(OBJ)
	@mkdir -p "$(BUILD_DIR)"
	$(CXX) $(LDFLAGS) -o $@ $^ $(LIBS)

-include $(DEP)

test-logic: $(TEST_TEARDOWN) $(TEST_RUNTIME) $(TEST_VISUAL)
	$(TEST_TEARDOWN)
	$(TEST_RUNTIME)
	$(TEST_VISUAL)

test-full: $(PLUGIN).so test-logic $(TEST_RELOAD)
	$(TEST_RELOAD)

test: test-logic

$(TEST_TEARDOWN): tests/test_teardown.cpp $(OBJ_DIR)/teardown.o
	$(CXX) -std=gnu++26 -O2 -g -o $@ tests/test_teardown.cpp $(OBJ_DIR)/teardown.o

$(TEST_RUNTIME): tests/test_runtime.cpp $(OBJ_DIR)/runtime.o
	$(CXX) -std=gnu++26 -O2 -g -o $@ tests/test_runtime.cpp $(OBJ_DIR)/runtime.o

$(TEST_RELOAD): tests/test_reload.cpp $(OBJ_DIR)/runtime.o
	$(CXX) -std=gnu++26 -O2 -g -o $@ tests/test_reload.cpp $(OBJ_DIR)/runtime.o

$(TEST_VISUAL): tests/test_visual.cpp $(OBJ_DIR)/runtime.o
	$(CXX) -std=gnu++26 -O2 -g -o $@ tests/test_visual.cpp $(OBJ_DIR)/runtime.o

$(DUMP_SHIMMER): tests/dump_shimmer.cpp $(OBJ_DIR)/runtime.o
	$(CXX) -std=gnu++26 -O2 -g -o $@ tests/dump_shimmer.cpp $(OBJ_DIR)/runtime.o

clean:
	rm -rf obj $(PLUGIN).so compile_flags.txt $(TESTS)
	@if [ "$(BUILD_DIR)" != "." ] && [ -n "$(BUILD_DIR)" ]; then \
	  rm -rf "$(OBJ_DIR)" "$(SO)"; \
	fi

clangd:
	@printf '%s\n' $(CXXFLAGS) | tr ' ' '\n' | grep -v '^$$' > compile_flags.txt
	@echo 'wrote compile_flags.txt'
