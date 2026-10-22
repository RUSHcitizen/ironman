/**
 * F.R.I.D.A.Y. scan database: what the targeting scan reports about each
 * hostile once analysis completes.
 */
export type Threat = "LOW" | "MODERATE" | "HIGH" | "EXTREME";

export interface Intel {
  name: string;
  cls: string;
  threat: Threat;
  /** Tactical tip shown once the scan resolves. */
  weakness: string;
}

export const INTEL: Record<string, Intel> = {
  drone: { name: "ATTACK DRONE", cls: "QUAD-ROTOR UAV", threat: "LOW", weakness: "Rotors exposed - one repulsor burst" },
  kamikaze: { name: "KAMIKAZE DRONE", cls: "LOITERING MUNITION", threat: "MODERATE", weakness: "Pop it before it closes - keep moving" },
  trooper: { name: "JET-PACK TROOPER", cls: "AIRBORNE INFANTRY", threat: "LOW", weakness: "Jet-pack fuel cell - knock them off the roof" },
  sniper: { name: "SNIPER", cls: "MARKSMAN", threat: "MODERATE", weakness: "Laser telegraphs the shot - break line of sight" },
  warbot: { name: "WARBOT", cls: "ASSAULT MECH", threat: "HIGH", weakness: "Slow turret traverse - flank it, rockets to the core" },
  titan: { name: "TITAN", cls: "SUPER-HEAVY MECH", threat: "EXTREME", weakness: "Stomp has a wind-up - stay airborne, Unibeam the core" },
  gunship: { name: "GUNSHIP", cls: "VTOL ASSAULT CRAFT", threat: "HIGH", weakness: "Rotor nacelles - rockets bring it down" },
  shielder: { name: "SHIELD DRONE", cls: "SUPPORT UAV", threat: "MODERATE", weakness: "Projects the shield - destroy it first" },
  tank: { name: "HOVER TANK", cls: "ARMOURED VEHICLE", threat: "HIGH", weakness: "Shells arc slowly - strafe and hit the turret" },
  jet: { name: "INTERCEPTOR", cls: "STRIKE FIGHTER", threat: "MODERATE", weakness: "Wide turning circle - catch it on the extend" },
  swarmer: { name: "SWARMER", cls: "MICRO SEEKER", threat: "LOW", weakness: "Fragile - sweep the pack with repulsors" },
  jammer: { name: "EMP JAMMER", cls: "ELECTRONIC WARFARE", threat: "MODERATE", weakness: "Pulse charges visibly - back off or kill it first" },
  carrier: { name: "DREADNOUGHT", cls: "CARRIER AIRSHIP", threat: "EXTREME", weakness: "Launch bay venting - rockets to the hull" },
  sentinel: { name: "SENTINEL", cls: "RAM DRONE", threat: "MODERATE", weakness: "Glows before the dash - sidestep, then punish" },
  spider: { name: "SPIDER WALKER", cls: "MORTAR PLATFORM", threat: "HIGH", weakness: "Mortar fan is predictable - hit it between volleys" },
  cloaker: { name: "CLOAKER", cls: "STEALTH UAV", threat: "MODERATE", weakness: "Visible when it fires - a hit drops the cloak" },
  bomber: { name: "HEAVY BOMBER", cls: "STRATEGIC BOMBER", threat: "HIGH", weakness: "Slow turns - hit it on the extend, mind the tail gun" },
  mine: { name: "AIR MINE", cls: "PROXIMITY MINE", threat: "MODERATE", weakness: "Detonate from range - chains through the field" },
  turret: { name: "FLAK TURRET", cls: "AIR DEFENCE", threat: "HIGH", weakness: "Fixed position - jink, then dive on it" },
  rival: { name: "ROGUE ARMOUR", cls: "POWERED SUIT", threat: "EXTREME", weakness: "Dodges single shots - rockets and close passes" },
  courier: { name: "COURIER DRONE", cls: "CARGO UAV", threat: "LOW", weakness: "Unarmed - run it down before it escapes" },
  arc: { name: "ARC DRONE", cls: "TESLA PLATFORM", threat: "MODERATE", weakness: "Must close to zap - keep your distance" },
};

export function intelFor(kind: string): Intel {
  return INTEL[kind] ?? { name: kind.toUpperCase(), cls: "UNKNOWN", threat: "MODERATE", weakness: "Insufficient data" };
}

/** Compass direction (8-point) of a bearing in radians (0 = north/+z, clockwise). */
export function compass8(bearing: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const k = Math.round((((bearing % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return dirs[k];
}

/** F.R.I.D.A.Y.'s summary line for an area scan. */
export function scanSummary(found: { kind: string; d: number; bearing: number }[]): string {
  if (found.length === 0) return "Area scan complete · no hostiles within 600 m";
  const heavy = found.filter((f) => {
    const t = intelFor(f.kind).threat;
    return t === "HIGH" || t === "EXTREME";
  }).length;
  const near = found.reduce((a, b) => (b.d < a.d ? b : a));
  return `Scan complete · ${found.length} hostile${found.length === 1 ? "" : "s"}${heavy ? ` · ${heavy} heavy` : ""} · nearest ${Math.round(near.d)} m ${compass8(near.bearing)}`;
}
