.pragma library

// CPU twin of the ripple fragment scalar. Chrome does not sample this
// per pixel; tests and docs drive the same formula the GLES/Qt bodies use:
//   crest = pow(max(sin(r * freq - time * speed), 0), max(power, 1))
// Energy mix is max(cone, gain * crest). gain 0 is shiny lighting.

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
  return Math.max(Number(cone), Number(gain) * Number(c))
}

// Twin of shinyRippleTime. Keep sub-frame precision in a float clock.
function rippleTime(clockSeconds) {
  var t = Number(clockSeconds) % TIME_WRAP
  if (t < 0)
    t += TIME_WRAP
  return t
}
