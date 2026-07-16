/**
 * OT RoundOff (Setup → OT → RoundOff = Yes):
 * INT([OT Hours]) + IF((([OT Hours]-INT([OT Hours]))*60)<=25, 0, 0.5)
 * ≤25 fractional minutes → whole hours; 26–59 → add 0.5 h.
 */
export function applyOtHoursRoundOff(otHours) {
  const h = Number(otHours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  const whole = Math.floor(h + 1e-6);
  const fracMin = (h - whole) * 60;
  if (fracMin <= 25 + 1e-6) return whole;
  return whole + 0.5;
}
