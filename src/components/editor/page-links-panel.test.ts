import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("PageLinksPanel missing-page writes", () => {
  it("routes creation through the read-only repair bridge helper", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./page-links-panel.tsx", import.meta.url)),
      "utf8",
    )

    expect(source).toContain("createMissingWikiPageWithRepairBridge")
    expect(source).not.toContain("await createMissingWikiPage(project.path")
  })
})
