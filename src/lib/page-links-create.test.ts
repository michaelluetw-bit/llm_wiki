import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createMissingWikiPage: vi.fn(),
  writeFile: vi.fn(),
}))

const repairMocks = vi.hoisted(() => ({
  ensureBrokenLinkStub: vi.fn(),
  requestLintRepairSync: vi.fn(),
  resolveLintRepairContext: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)
vi.mock("@/lib/lint-fixes", () => repairMocks)

import { createMissingWikiPageWithRepairBridge } from "./page-links-create"

beforeEach(() => {
  fsMocks.createMissingWikiPage.mockReset()
  fsMocks.writeFile.mockReset()
  repairMocks.ensureBrokenLinkStub.mockReset()
  repairMocks.requestLintRepairSync.mockReset()
  repairMocks.resolveLintRepairContext.mockReset()
})

describe("createMissingWikiPageWithRepairBridge", () => {
  it("keeps ordinary project creation on the existing direct path", async () => {
    const context = {
      projectRoot: "/project",
      mutationRoot: "/project",
      bridge: null,
    }
    repairMocks.resolveLintRepairContext.mockResolvedValue(context)
    fsMocks.createMissingWikiPage.mockResolvedValue("wiki/concepts/local.md")

    await expect(createMissingWikiPageWithRepairBridge(
      "/project",
      "Local",
      undefined,
    )).resolves.toBe("wiki/concepts/local.md")

    expect(fsMocks.createMissingWikiPage).toHaveBeenCalledWith(
      "/project",
      "Local",
      undefined,
    )
    expect(repairMocks.requestLintRepairSync).not.toHaveBeenCalled()
  })

  it("writes a readonly missing page to the canonical wiki and rebuilds the mirror", async () => {
    const context = {
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1 as const, sourceRoot: "/source" },
    }
    repairMocks.resolveLintRepairContext.mockResolvedValue(context)
    fsMocks.createMissingWikiPage.mockResolvedValue("wiki/concepts/missing-page.md")
    repairMocks.requestLintRepairSync.mockResolvedValue(undefined)

    await expect(createMissingWikiPageWithRepairBridge(
      "/sidecar",
      "Missing Page",
      "# Draft",
    )).resolves.toBe("wiki/concepts/missing-page.md")

    expect(fsMocks.createMissingWikiPage).toHaveBeenCalledWith(
      "/source",
      "Missing Page",
      "# Draft",
    )
    expect(repairMocks.requestLintRepairSync).toHaveBeenCalledWith(context)
  })
  it("reuses an existing canonical path target without overwriting it", async () => {
    const context = {
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1 as const, sourceRoot: "/source" },
    }
    repairMocks.resolveLintRepairContext.mockResolvedValue(context)
    repairMocks.ensureBrokenLinkStub.mockResolvedValue({
      fullPath: "/source/wiki/queries/ai-assistant.md",
      relativePath: "queries/ai-assistant.md",
      created: false,
    })
    repairMocks.requestLintRepairSync.mockResolvedValue(undefined)
    fsMocks.createMissingWikiPage.mockResolvedValue("wiki/concepts/duplicate.md")

    await expect(createMissingWikiPageWithRepairBridge(
      "/sidecar",
      "queries/ai-assistant",
      "# Replacement",
    )).resolves.toBe("wiki/queries/ai-assistant.md")

    expect(repairMocks.ensureBrokenLinkStub).toHaveBeenCalledWith(
      "/source",
      "queries/ai-assistant",
    )
    expect(fsMocks.createMissingWikiPage).not.toHaveBeenCalled()
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
    expect(repairMocks.requestLintRepairSync).toHaveBeenCalledWith(context)
  })

  it("writes an Agent draft only when a canonical path target is newly created", async () => {
    const context = {
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1 as const, sourceRoot: "/source" },
    }
    repairMocks.resolveLintRepairContext.mockResolvedValue(context)
    repairMocks.ensureBrokenLinkStub.mockResolvedValue({
      fullPath: "/source/wiki/queries/new-topic.md",
      relativePath: "queries/new-topic.md",
      created: true,
    })
    repairMocks.requestLintRepairSync.mockResolvedValue(undefined)

    await expect(createMissingWikiPageWithRepairBridge(
      "/sidecar",
      "queries/new-topic",
      "# Agent Draft",
    )).resolves.toBe("wiki/queries/new-topic.md")

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/source/wiki/queries/new-topic.md",
      "# Agent Draft",
    )
    expect(fsMocks.createMissingWikiPage).not.toHaveBeenCalled()
    expect(repairMocks.requestLintRepairSync).toHaveBeenCalledWith(context)
  })

})
