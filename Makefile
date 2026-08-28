# Convenience for `hyprpm add` / `make` at the clone root.
# The compositor plugin lives in hypr/.

.PHONY: all test test-logic test-full clean clangd

all:
	$(MAKE) -C hypr all

test:
	$(MAKE) -C hypr test

test-logic:
	$(MAKE) -C hypr test-logic

test-full:
	$(MAKE) -C hypr test-full

clean:
	$(MAKE) -C hypr clean

clangd:
	$(MAKE) -C hypr clangd
