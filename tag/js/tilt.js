// Tilt steering: turn the phone like a steering wheel.
//
// From the browser's orientation angles we work out which way gravity pulls across the
// screen, taking into account how the screen is currently rotated. That reads correctly
// whether the phone is held upright like a wheel or lying flat and tipped left/right.

// Returns gravity's pull toward the screen's right edge: 0 when level, about +0.5 when
// turned 30 degrees clockwise (steer right), about -0.5 when turned 30 degrees anticlockwise.
export function tiltAmount(betaDeg, gammaDeg, screenAngleDeg) {
    const b = (betaDeg * Math.PI) / 180;
    const g = (gammaDeg * Math.PI) / 180;
    const a = (screenAngleDeg * Math.PI) / 180;
    // Direction of gravity in the phone's own axes (x across, y up the screen when portrait)
    const gx = Math.cos(b) * Math.sin(g);
    const gy = -Math.sin(b);
    // Rotate into the screen's current orientation and keep the across-the-screen part
    return gx * Math.cos(a) - gy * Math.sin(a);
}

// Turn a raw tilt reading into a steering input from -1 to 1
export function tiltToSteer(amount, zero) {
    const t = (amount - zero) / 0.42;   // about 25 degrees of turn for full lock
    if (Math.abs(t) < 0.08) return 0;   // small dead zone so holding still goes straight
    return Math.max(-1, Math.min(1, t));
}
