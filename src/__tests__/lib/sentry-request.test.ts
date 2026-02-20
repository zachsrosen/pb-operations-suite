const setTag = jest.fn();
const getCurrentScope = jest.fn(() => ({ setTag }));
const getClient = jest.fn();
const init = jest.fn();
const resolveSentryDsn = jest.fn();

jest.mock("@sentry/nextjs", () => ({
  getCurrentScope,
  getClient,
  init,
}));

jest.mock("@/lib/sentry-dsn", () => ({
  resolveSentryDsn,
}));

import { tagSentryRequest } from "@/lib/sentry-request";

describe("tagSentryRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initializes Sentry when client is missing and DSN exists", () => {
    getClient.mockReturnValue(undefined);
    resolveSentryDsn.mockReturnValue("https://dsn@o1.ingest.sentry.io/1");

    tagSentryRequest(new Request("https://example.com", { headers: { "x-request-id": "req-123" } }));

    expect(init).toHaveBeenCalledTimes(1);
    expect(setTag).toHaveBeenCalledWith("request_id", "req-123");
  });

  it("does not initialize when DSN is missing", () => {
    getClient.mockReturnValue(undefined);
    resolveSentryDsn.mockReturnValue(undefined);

    tagSentryRequest(new Request("https://example.com"));

    expect(init).not.toHaveBeenCalled();
    expect(setTag).toHaveBeenCalledWith("request_id", "unknown");
  });

  it("does not re-initialize when client exists", () => {
    getClient.mockReturnValue({ id: "client" });

    tagSentryRequest(new Request("https://example.com"));

    expect(init).not.toHaveBeenCalled();
    expect(setTag).toHaveBeenCalledTimes(1);
  });
});
