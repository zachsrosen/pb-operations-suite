/**
 * Tests for fetchLineItemsForDeals — specifically that it chunks both
 * the deal-association batch read and the line-item batch read at the
 * HubSpot batch cap of 100, so property-sync rollups over properties
 * with >100 linked deals (or deals that fan out to >100 line items)
 * don't exceed the batch input limit.
 */

const associationsBatchRead = jest.fn();
const lineItemsBatchRead = jest.fn();

jest.mock("@hubspot/api-client", () => ({
  Client: jest.fn().mockImplementation(() => ({
    crm: {
      associations: {
        batchApi: {
          read: (...args: unknown[]) => associationsBatchRead(...args),
        },
      },
      lineItems: {
        batchApi: {
          read: (...args: unknown[]) => lineItemsBatchRead(...args),
        },
      },
    },
  })),
  // Re-export enum used by hubspot.ts top-level import
}));

jest.mock("@hubspot/api-client/lib/codegen/crm/deals", () => ({
  FilterOperatorEnum: {},
}));

describe("fetchLineItemsForDeals chunking", () => {
  beforeEach(() => {
    associationsBatchRead.mockReset();
    lineItemsBatchRead.mockReset();
  });

  it("chunks 150 deal IDs into two association batch reads (100 + 50)", async () => {
    // Each deal has zero line items so we only exercise the association chunking.
    associationsBatchRead.mockResolvedValue({ results: [] });

    const { fetchLineItemsForDeals } = await import("@/lib/hubspot");
    const dealIds = Array.from({ length: 150 }, (_, i) => `deal-${i}`);

    const result = await fetchLineItemsForDeals(dealIds);

    expect(result).toEqual([]);
    expect(associationsBatchRead).toHaveBeenCalledTimes(2);

    // First call: 100 IDs
    const firstCallArgs = associationsBatchRead.mock.calls[0];
    const firstInputs = (firstCallArgs[2] as { inputs: Array<{ id: string }> }).inputs;
    expect(firstInputs).toHaveLength(100);

    // Second call: 50 IDs
    const secondCallArgs = associationsBatchRead.mock.calls[1];
    const secondInputs = (secondCallArgs[2] as { inputs: Array<{ id: string }> }).inputs;
    expect(secondInputs).toHaveLength(50);

    // Line items batch should NOT be called since there were no associations.
    expect(lineItemsBatchRead).not.toHaveBeenCalled();
  });

  it("chunks line item IDs at 100 when associations fan out to >100 items", async () => {
    // 5 deals, each with 30 line items = 150 total line items.
    associationsBatchRead.mockImplementation((_from, _to, body: { inputs: Array<{ id: string }> }) => {
      const results = body.inputs.map(({ id }) => ({
        _from: { id },
        to: Array.from({ length: 30 }, (_, j) => ({ id: `li-${id}-${j}` })),
      }));
      return Promise.resolve({ results });
    });
    lineItemsBatchRead.mockImplementation((body: { inputs: Array<{ id: string }> }) => ({
      results: body.inputs.map(({ id }) => ({
        id,
        properties: {
          name: "Part",
          quantity: "1",
          price: "0",
          amount: "0",
        },
      })),
    }));

    const { fetchLineItemsForDeals } = await import("@/lib/hubspot");
    const dealIds = Array.from({ length: 5 }, (_, i) => `deal-${i}`);

    const result = await fetchLineItemsForDeals(dealIds);

    // Line items batch read should be called twice: 100 + 50
    expect(lineItemsBatchRead).toHaveBeenCalledTimes(2);
    const firstInputs = (lineItemsBatchRead.mock.calls[0][0] as { inputs: Array<{ id: string }> }).inputs;
    const secondInputs = (lineItemsBatchRead.mock.calls[1][0] as { inputs: Array<{ id: string }> }).inputs;
    expect(firstInputs).toHaveLength(100);
    expect(secondInputs).toHaveLength(50);

    expect(result).toHaveLength(150);
  });
});
