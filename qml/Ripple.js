.pragma library

// CPU twin of the ripple fragment scalar. Chrome does not sample this
// per pixel; tests and docs drive the same formula the GLES/Qt bodies use:
//   crest = pow(max(sin(r * freq - time * speed), 0), max(power, 1))
// Energy mix is mix(cone, clamp(gain * crest, 0, 1), clamp(gain, 0, 1)).
// gain 0 is shiny lighting; gain 1 replaces the comet with crests.

var TIME_WRAP = 1024

function crest(r, t, freq, speed, power) {
  var wave = Math.sin(Number(r) * Number(freq) - Number(t) * Number(speed))
  if (!(wave > 0))
    return 0
  var p = Number(power)
  if (!(p > 1))
    p = 1
  return Math.pow(wave, p)
}

function energy(cone, c, gain) {
  var g = Number(gain)
  if (g < 0)
    g = 0
  if (g > 1)
    g = 1
  var crestLit = Number(gain) * Number(c)
  if (crestLit < 0)
    crestLit = 0
  if (crestLit > 1)
    crestLit = 1
  return Number(cone) * (1 - g) + crestLit * g
}

function highlightAlpha(stopA, cov, c, gain, pulseMul) {
  if (pulseMul === undefined || pulseMul === null)
    pulseMul = 1
  var a = energy(stopA, c, gain) * Number(cov) * Number(pulseMul)
  if (a < 0)
    return 0
  if (a > 1)
    return 1
  return a
}

// Twin of shinyRippleTime. Keep sub-frame precision in a float clock.
function rippleTime(clockSeconds) {
  var t = Number(clockSeconds) % TIME_WRAP
  if (t < 0)
    t += TIME_WRAP
  return t
}
