jest.mock("@/lib/db", () => ({
  prisma: { systemConfig: { findUnique: jest.fn(), upsert: jest.fn() } },
  getUserByEmail: jest.fn(),
}));
jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/flow-map/store");
jest.mock("@/lib/flow-map/sync", () => ({ syncFlowMap: jest.fn() }));
import * as store from "@/lib/flow-map/store";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { GET } from "@/app/api/workflow-map/route";
import { POST } from "@/app/api/workflow-map/refresh/route";

test("GET returns snapshot when present", async () => {
  (store.getSnapshot as jest.Mock).mockResolvedValue({ generatedAt: "x", flows: {}, pipelines: [], stageLookup: {}, links: [], portalId: "" });
  const body = await (await GET()).json();
  expect(body.generatedAt).toBe("x");
});

test("GET returns {empty:true} when never synced", async () => {
  (store.getSnapshot as jest.Mock).mockResolvedValue(null);
  const body = await (await GET()).json();
  expect(body.empty).toBe(true);
});

test("POST refresh returns 403 for non-admin user", async () => {
  (auth as jest.Mock).mockResolvedValue({ user: { email: "ops@photonbrothers.com" } });
  (getUserByEmail as jest.Mock).mockResolvedValue({ email: "ops@photonbrothers.com", roles: ["OPERATIONS"] });
  const res = await POST();
  expect(res.status).toBe(403);
});
