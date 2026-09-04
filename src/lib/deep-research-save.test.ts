import { describe, expect, it, vi } from "vitest"
import { persistResearchPage } from "./deep-research"
import type { LintRepairContext } from "./lint-fixes"

describe("persistResearchPage", () => {
  it("writes read-only project research into the canonical Wiki and syncs the mirror", async () => {
    const context: LintRepairContext = {
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1, sourceRoot: "/source" },
    }
    const write = vi.fn().mockResolvedValue(undefined)
    const sync = vi.fn().mockResolvedValue(undefined)

    await expect(persistResearchPage(
      "/sidecar",
      "research-topic.md",
      "# Research",
      {
        resolveRepairContext: vi.fn().mockResolvedValue(context),
        requestRepairSync: sync,
        write,
        exists: vi.fn().mockResolvedValue(false),
      },
    )).resolves.toEqual({
      filePath: "/source/wiki/queries/research-topic.md",
      savedPath: "wiki/queries/research-topic.md",
    })

    expect(write).toHaveBeenCalledWith(
      "/source/wiki/queries/research-topic.md",
      "# Research",
    )
    expect(sync).toHaveBeenCalledWith(context)
  })

  it("retains the canonical save when mirror sync fails", async () => {
    const context: LintRepairContext = {
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1, sourceRoot: "/source" },
    }
    const write = vi.fn().mockResolvedValue(undefined)

    await expect(persistResearchPage(
      "/sidecar",
      "research-topic.md",
      "# Research",
      {
        resolveRepairContext: vi.fn().mockResolvedValue(context),
        requestRepairSync: vi.fn().mockRejectedValue(new Error("sync failed")),
        write,
        exists: vi.fn().mockResolvedValue(false),
      },
    )).resolves.toEqual({
      filePath: "/source/wiki/queries/research-topic.md",
      savedPath: "wiki/queries/research-topic.md",
      syncError: "sync failed",
    })

    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe("persistResearchPage without repair bridge", () => {
  it("preserves the existing project-local save path", async () => {
    const context: LintRepairContext = {
      projectRoot: "/project",
      mutationRoot: "/project",
      bridge: null,
    }
    const write = vi.fn().mockResolvedValue(undefined)

    await expect(persistResearchPage(
      "/project",
      "research-topic.md",
      "# Research",
      {
        resolveRepairContext: vi.fn().mockResolvedValue(context),
        requestRepairSync: vi.fn().mockResolvedValue(undefined),
        write,
        exists: vi.fn().mockResolvedValue(false),
      },
    )).resolves.toEqual({
      filePath: "/project/wiki/queries/research-topic.md",
      savedPath: "wiki/queries/research-topic.md",
    })

    expect(write).toHaveBeenCalledWith(
      "/project/wiki/queries/research-topic.md",
      "# Research",
    )
  })
})
