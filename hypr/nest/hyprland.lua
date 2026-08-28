-- Nested crash-sandbox. Not Omarchy. ALT binds so they don't fight SUPER outside.
-- Launch: mise run nest
-- Plugin keys are unknown until the .so is loaded, so they are gated below.
-- hyprland.start loads the plugin; PLUGIN_INIT reloads this file and the gate opens.
-- Outer-terminal rebuilds: mise run reload

local ROOT = os.getenv("SHINY_HYPR_ROOT")
if not ROOT or ROOT == "" then
  local project = os.getenv("MISE_PROJECT_ROOT") or os.getenv("PWD") or "."
  ROOT = project .. "/hypr"
end

local function shinyLoaded()
  for _, p in ipairs(hl.get_loaded_plugins()) do
    if p.name == "hypr-shiny-border" then
      return true
    end
  end
  return false
end

hl.config({
  general = {
    -- Stock border off; the plugin draws its own ring.
    border_size = 0,
    gaps_in = 10,
    gaps_out = 20,
    layout = "dwindle",
    col = {
      active_border = { colors = { "rgba(33ccffee)", "rgba(00ff99ee)" }, angle = 45 },
      inactive_border = "rgba(595959aa)",
    },
  },

  decoration = {
    rounding = 16,
    blur = { enabled = false },
    shadow = { enabled = false },
  },

  animations = {
    enabled = true,
  },

  misc = {
    disable_hyprland_logo = true,
    disable_splash_rendering = true,
  },

  ecosystem = {
    no_update_news = true,
    no_donation_nag = true,
  },
})

if shinyLoaded() then
  hl.config({
    plugin = {
      shiny_border = {
        enabled = true,
        active_only = true,
        pulse = true,
        pulse_hz = 0.4,
        lobe = 0.18,
        quantize_deg = 1,
        angle_offset = 0,
        border_size = 3,
      },
    },
  })
end

-- Color interpolation on the stock border would fight mouse tracking.
hl.animation({ leaf = "border", enabled = false })
hl.animation({ leaf = "borderangle", enabled = false })

hl.bind("ALT + Return", hl.dsp.exec_cmd("foot"))
hl.bind("ALT + Q", hl.dsp.window.close({}))
hl.bind("ALT + M", hl.dsp.exit())
hl.bind("ALT + R", hl.dsp.exec_cmd("hyprctl reload"))

hl.on("hyprland.start", function()
  if shinyLoaded() then
    return
  end
  hl.exec_cmd(ROOT .. "/scripts/pluginctl.sh load")
end)
