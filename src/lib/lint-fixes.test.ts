import { beforeEach, describe, expect, it, vi } from "vitest"

const projectStoreMocks = vi.hoisted(() => ({
  loadRepairBridgeSourceRoot: vi.fn(),
}))

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)
vi.mock("@/lib/project-store", () => projectStoreMocks)

import {
  appendWikilink,
  deleteOrphanWithRepairBridge,
  ensureBrokenLinkStub,
  requestLintRepairSync,
  resolveLintRepairContext,
  rewriteWikilinkTarget,
  stubRelativePathFromBrokenTarget,
  type LintRepairContext,
} from "./lint-fixes"

beforeEach(() => {
  projectStoreMocks.loadRepairBridgeSourceRoot.mockReset()
  projectStoreMocks.loadRepairBridgeSourceRoot.mockResolvedValue(null)
  fsMocks.createDirectory.mockReset()
  fsMocks.deleteFile.mockReset()
  fsMocks.fileExists.mockReset()
  fsMocks.readFile.mockReset()
  fsMocks.writeFile.mockReset()
  fsMocks.createDirectory.mockResolvedValue(undefined)
  fsMocks.deleteFile.mockResolvedValue(undefined)
  fsMocks.writeFile.mockResolvedValue(undefined)
})

describe("rewriteWikilinkTarget", () => {
  it("rewrites a matching wikilink and preserves aliases", () => {
    const out = rewriteWikilinkTarget(
      "See [[transfomer|the Transformer page]] and [[attention]].",
      "transfomer",
      "entities/transformer.md",
    )

    expect(out).toBe("See [[entities/transformer|the Transformer page]] and [[attention]].")
  })

  it("leaves non-matching wikilinks byte-identical", () => {
    const input = "See [[attention|Attention]] only."
    expect(rewriteWikilinkTarget(input, "transformer", "entities/transformer.md")).toBe(input)
  })
})

describe("appendWikilink", () => {
  it("does not duplicate an existing aliased wikilink", () => {
    const input = "See [[entities/transformer|Transformer]]."
    expect(appendWikilink(input, "entities/transformer.md")).toBe(input)
  })

  it("appends a related section when the target is absent", () => {
    expect(appendWikilink("# Page\nBody", "entities/transformer.md")).toBe(
      "# Page\nBody\n\n## Related\n- [[entities/transformer]]\n",
    )
  })

  it("adds to an existing related section without duplicating the heading", () => {
    const out = appendWikilink(
      "# Page\n\n## Related\n- [[entities/attention]]\n",
      "entities/transformer.md",
    )

    expect(out.match(/^## Related$/gm)).toHaveLength(1)
    expect(out).toContain("## Related\n- [[entities/transformer]]\n- [[entities/attention]]")
  })
})

describe("ensureBrokenLinkStub", () => {
  it("reuses an existing slugified target instead of overwriting it", async () => {
    fsMocks.fileExists.mockResolvedValue(true)

    const result = await ensureBrokenLinkStub("/project", "Foo Bar")

    expect(result).toEqual({
      fullPath: "/project/wiki/queries/foo-bar.md",
      relativePath: "queries/foo-bar.md",
      created: false,
    })
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it("creates a safe stub path when no target exists", async () => {
    fsMocks.fileExists.mockResolvedValue(false)

    const result = await ensureBrokenLinkStub("/project", "Foo Bar")

    expect(result.relativePath).toBe("queries/foo-bar.md")
    expect(fsMocks.createDirectory).toHaveBeenCalledWith("/project/wiki/queries")
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/wiki/queries/foo-bar.md",
      expect.stringContaining("title: \"Foo Bar\""),
    )
  })

  it("keeps explicit wiki subdirectories when building stub paths", () => {
    expect(stubRelativePathFromBrokenTarget("concepts/Foo Bar")).toBe("concepts/foo-bar.md")
  })
})


describe("lint repair bridge", () => {
  it("keeps ordinary project repairs on their existing project root", async () => {
    fsMocks.fileExists.mockResolvedValue(false)

    await expect(resolveLintRepairContext("/project/")).resolves.toEqual({
      projectRoot: "/project",
      mutationRoot: "/project",
      bridge: null,
    })
  })

  it("redirects a trusted read-only repair to the canonical source root", async () => {
    projectStoreMocks.loadRepairBridgeSourceRoot.mockResolvedValue("/source")
    fsMocks.fileExists.mockImplementation(async (path: string) =>
      path === "/sidecar/.llm-wiki/repair-bridge.json" || path === "/source/wiki")
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ version: 1, sourceRoot: "/source" }))

    await expect(resolveLintRepairContext("/sidecar")).resolves.toEqual({
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1, sourceRoot: "/source" },
    })
  })

  it("rejects a project-controlled bridge that is not trusted by app state", async () => {
    projectStoreMocks.loadRepairBridgeSourceRoot.mockResolvedValue("/trusted-source")
    fsMocks.fileExists.mockImplementation(async (path: string) =>
      path === "/sidecar/.llm-wiki/repair-bridge.json" || path === "/unrelated/wiki")
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ version: 1, sourceRoot: "/unrelated" }))

    await expect(resolveLintRepairContext("/sidecar")).rejects.toThrow(/trusted/i)
  })

  it("fails closed when a repair bridge exists but points to an invalid source", async () => {
    fsMocks.fileExists.mockImplementation(async (path: string) =>
      path === "/sidecar/.llm-wiki/repair-bridge.json")
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ version: 1, sourceRoot: "relative/source" }))

    await expect(resolveLintRepairContext("/sidecar")).rejects.toThrow(/repair bridge/i)
  })

  it("deletes bridged orphans from the canonical Wiki and rebuilds the mirror", async () => {
    const context: LintRepairContext = {
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1, sourceRoot: "/source" },
    }
    const cascade = vi.fn().mockResolvedValue({ deletedPaths: [], rewrittenFiles: 0 })
    const sync = vi.fn().mockResolvedValue(undefined)

    await deleteOrphanWithRepairBridge("/sidecar", "concepts/orphan.md", {
      resolveRepairContext: vi.fn().mockResolvedValue(context),
      cascadeDelete: cascade,
      requestRepairSync: sync,
    })

    expect(cascade).toHaveBeenCalledWith(
      "/source",
      ["/source/wiki/concepts/orphan.md"],
    )
    expect(sync).toHaveBeenCalledWith(context)
  })

  it("queues an immediate mirror rebuild and waits for its success result", async () => {
    fsMocks.fileExists.mockImplementation(async (path: string) =>
      path.includes("/repair-results/") && path.endsWith(".json"))
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ ok: true }))

    await requestLintRepairSync({
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1, sourceRoot: "/source" },
    })

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/sidecar\/\.llm-wiki\/repair-queue\/.+\.request$/),
      expect.stringContaining('"sourceRoot":"/source"'),
    )
    expect(fsMocks.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/sidecar\/\.llm-wiki\/repair-results\/.+\.json$/),
    )
  })

  it("fails closed when the immediate mirror rebuild reports failure", async () => {
    fsMocks.fileExists.mockImplementation(async (path: string) =>
      path.includes("/repair-results/") && path.endsWith(".json"))
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ ok: false, error: "sync failed" }))

    await expect(requestLintRepairSync({
      projectRoot: "/sidecar",
      mutationRoot: "/source",
      bridge: { version: 1, sourceRoot: "/source" },
    })).rejects.toThrow(/sync failed/i)

    expect(fsMocks.deleteFile).toHaveBeenCalledTimes(1)
  })
})
