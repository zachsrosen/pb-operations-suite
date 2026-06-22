import { resolveDriveFolderId } from "@/lib/eagleview-folder";

describe("resolveDriveFolderId", () => {
  it("extracts the folder ID from a full Drive URL", () => {
    // Recent HubSpot deals store design_documents as a URL, not a bare ID.
    // This is the exact value that stranded EagleView delivery (drive_folder_create_failed).
    expect(
      resolveDriveFolderId(
        "https://drive.google.com/drive/folders/1Mk3t7gmSVBEsdEoqYVrLsaasKOgTcW45",
      ),
    ).toBe("1Mk3t7gmSVBEsdEoqYVrLsaasKOgTcW45");
  });

  it("passes a bare folder ID through unchanged", () => {
    expect(resolveDriveFolderId("1bybkGf5kKqW0CafTsK_ZQvFqmis4ozfN")).toBe(
      "1bybkGf5kKqW0CafTsK_ZQvFqmis4ozfN",
    );
  });

  it("skips null/empty candidates and uses the first that yields a valid ID", () => {
    // Mirrors a real stuck deal: design_document_folder_id null, design_documents a URL.
    expect(
      resolveDriveFolderId(
        null,
        "https://drive.google.com/drive/folders/1otJJVqXJk2HtRUDemKFJHOBl0JPBJAiv",
        "1bknqif3xh7_reHjmcZIsER7Jr47M9_qE",
      ),
    ).toBe("1otJJVqXJk2HtRUDemKFJHOBl0JPBJAiv");
  });

  it("returns null when no candidate yields a usable ID", () => {
    expect(resolveDriveFolderId(null, undefined, "")).toBeNull();
  });

  it("strips Drive URL query params", () => {
    expect(
      resolveDriveFolderId(
        "https://drive.google.com/drive/folders/1AbcDEfgHIjkLMnoPQ?usp=sharing",
      ),
    ).toBe("1AbcDEfgHIjkLMnoPQ");
  });
});
