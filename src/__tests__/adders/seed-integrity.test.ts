// @db-required — requires prisma migrate dev to be applied AND the seed
// script to have been run (`npx tsx scripts/seed-adders.ts <csv>`) before this
// test will pass. The example CSV contains only a subset of the codes checked
// below — expect missing-code failures until the Phase 0 canonical CSV is
// loaded. Do NOT disable this test; fix the CSV.
import { prisma } from "@/lib/db";

const IDR_ADDER_COLUMNS_TO_CODES: Record<string, string> = {
  adderTileRoof: "ROOF_TILE",
  adderTrenching: "TRENCH_LF",
  adderGroundMount: "GROUND_MOUNT",
  adderMpuUpgrade: "MPU_200A",
  adderEvCharger: "EV_CHARGER_L2",
  adderSteepPitch: "ROOF_STEEP_8_12",
  adderTwoStorey: "STOREY_2",
};

describe("seed integrity", () => {
  test.each(Object.entries(IDR_ADDER_COLUMNS_TO_CODES))(
    "%s has matching catalog code %s",
    async (_column, code) => {
      const adder = await prisma.adder.findUnique({ where: { code } });
      expect(adder).not.toBeNull();
      expect(adder?.active).toBe(true);
    }
  );
});
