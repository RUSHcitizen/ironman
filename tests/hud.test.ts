import { describe, it, expect } from "vitest";
import { INTEL, intelFor, scanSummary, compass8 } from "../src/ui/ScanIntel";
import { ENEMY_STATS } from "../src/combat/Enemies";

describe("F.R.I.D.A.Y. scan intel", () => {
  it("has a dossier for every enemy type", () => {
    for (const kind of Object.keys(ENEMY_STATS)) {
      expect(INTEL[kind], kind).toBeDefined();
      expect(intelFor(kind).weakness.length).toBeGreaterThan(5);
    }
    expect(intelFor("unknown").cls).toBe("UNKNOWN");
  });

  it("summarises an area scan: count, heavies and the nearest bearing", () => {
    expect(scanSummary([])).toMatch(/no hostiles/);
    const s = scanSummary([
      { kind: "drone", d: 300, bearing: 0 },
      { kind: "titan", d: 120, bearing: Math.PI / 2 },
      { kind: "bomber", d: 500, bearing: Math.PI },
    ]);
    expect(s).toBe("Scan complete · 3 hostiles · 2 heavy · nearest 120 m E");
    expect(compass8(-Math.PI / 4)).toBe("NW");
  });
});
