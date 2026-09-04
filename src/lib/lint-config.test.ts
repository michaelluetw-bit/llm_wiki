import { describe, expect, it } from "vitest"
import { DEFAULT_LINT_CONFIG, normalizeLintConfig } from "./lint-config"

describe("lint config", () => {
  it("preserves existing lint behavior by default", () => {
    expect(normalizeLintConfig()).toEqual(DEFAULT_LINT_CONFIG)
  })

  it("normalizes comma and newline separated ignored pages", () => {
    expect(normalizeLintConfig({
      ignoreOrphan: true,
      ignorePages: ["alpha, beta", "beta\nfolder/gamma.md", ""],
    })).toEqual({
      ignoreOrphan: true,
      ignoreNoOutlinks: false,
      ignorePages: ["alpha", "beta", "folder/gamma.md"],
      ignoreBrokenLinkPrefixes: [],
    })
  })

  it("trims ignored broken-link prefixes before removing wiki root", () => {
    expect(normalizeLintConfig({
      ignoreBrokenLinkPrefixes: [" wiki/raw/ "],
    }).ignoreBrokenLinkPrefixes).toEqual(["raw/"])
  })

  it("normalizes ignored broken-link prefixes without allowing empty entries", () => {
    expect(normalizeLintConfig({
      ignoreBrokenLinkPrefixes: [" raw/ ", "wiki/raw/", "RAW/", ""],
    })).toEqual({
      ignoreOrphan: false,
      ignoreNoOutlinks: false,
      ignorePages: [],
      ignoreBrokenLinkPrefixes: ["raw/"],
    })
  })
})
