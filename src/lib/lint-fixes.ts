import { createDirectory, deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { getFileName, isAbsolutePath, normalizePath } from "@/lib/path-utils"
import { loadRepairBridgeSourceRoot } from "@/lib/project-store"
import { cascadeDeleteWikiPagesWithRefs } from "@/lib/wiki-page-delete"
import { makeQuerySlug } from "@/lib/wiki-filename"

export interface LintRepairBridge {
  version: 1
  sourceRoot: string
}

export interface LintRepairContext {
  projectRoot: string
  mutationRoot: string
  bridge: LintRepairBridge | null
}

function normalizedRoot(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

export async function resolveLintRepairContext(projectPath: string): Promise<LintRepairContext> {
  const projectRoot = normalizedRoot(projectPath)
  const bridgePath = `${projectRoot}/.llm-wiki/repair-bridge.json`
  if (!(await fileExists(bridgePath))) {
    return { projectRoot, mutationRoot: projectRoot, bridge: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(bridgePath))
  } catch (error) {
    throw new Error(`Invalid lint repair bridge config: ${String(error)}`)
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid lint repair bridge config: expected object")
  }
  const candidate = parsed as { version?: unknown; sourceRoot?: unknown }
  if (candidate.version !== 1 || typeof candidate.sourceRoot !== "string") {
    throw new Error("Invalid lint repair bridge config: unsupported schema")
  }

  const sourceRoot = normalizedRoot(candidate.sourceRoot)
  if (!isAbsolutePath(sourceRoot) || sourceRoot === projectRoot) {
    throw new Error("Invalid lint repair bridge config: sourceRoot must be a separate absolute path")
  }
  if (!(await fileExists(`${sourceRoot}/wiki`))) {
    throw new Error("Invalid lint repair bridge config: source wiki does not exist")
  }
  const trustedSourceRoot = await loadRepairBridgeSourceRoot(projectRoot)
  if (!trustedSourceRoot || normalizedRoot(trustedSourceRoot) !== sourceRoot) {
    throw new Error("Invalid lint repair bridge config: sourceRoot is not trusted by app state")
  }

  const bridge: LintRepairBridge = { version: 1, sourceRoot }
  return { projectRoot, mutationRoot: sourceRoot, bridge }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

interface DeleteOrphanWithRepairBridgeDeps {
  resolveRepairContext?: (projectPath: string) => Promise<LintRepairContext>
  cascadeDelete?: typeof cascadeDeleteWikiPagesWithRefs
  requestRepairSync?: (context: LintRepairContext) => Promise<void>
}

export async function deleteOrphanWithRepairBridge(
  projectPath: string,
  page: string,
  deps: DeleteOrphanWithRepairBridgeDeps = {},
): Promise<void> {
  const resolveRepairContext = deps.resolveRepairContext ?? resolveLintRepairContext
  const cascadeDelete = deps.cascadeDelete ?? cascadeDeleteWikiPagesWithRefs
  const requestRepairSync = deps.requestRepairSync ?? requestLintRepairSync
  const context = await resolveRepairContext(projectPath)
  const pagePath = `${context.mutationRoot}/wiki/${page}`
  await cascadeDelete(context.mutationRoot, [pagePath])
  await requestRepairSync(context)
}

export async function requestLintRepairSync(context: LintRepairContext): Promise<void> {
  if (!context.bridge) return

  const requestId = crypto.randomUUID()
  const runtimeRoot = `${context.projectRoot}/.llm-wiki`
  const requestPath = `${runtimeRoot}/repair-queue/${requestId}.request`
  const resultPath = `${runtimeRoot}/repair-results/${requestId}.json`
  await writeFile(requestPath, JSON.stringify({ sourceRoot: context.bridge.sourceRoot }))

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await fileExists(resultPath)) {
      let result: unknown
      try {
        result = JSON.parse(await readFile(resultPath))
      } finally {
        try {
          await deleteFile(resultPath)
        } catch {
          // Best-effort cleanup; the sync result itself is authoritative.
        }
      }
      if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) {
        const error = result && typeof result === "object"
          ? (result as { error?: unknown }).error
          : null
        throw new Error(`Read-only mirror rebuild failed${error ? `: ${String(error)}` : ""}`)
      }
      return
    }
    await delay(100)
  }

  throw new Error("Repair was written to the canonical Wiki, but the read-only mirror rebuild timed out")
}

export function lintLinkTarget(target: string): string {
  return normalizePath(target)
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
    .trim()
}

function normalizedLintLinkTarget(target: string): string {
  return lintLinkTarget(target).toLowerCase()
}

function hasWikilinkToTarget(content: string, target: string): boolean {
  const normalized = normalizedLintLinkTarget(target)
  return Array.from(content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g))
    .some((match) => normalizedLintLinkTarget(match[1]) === normalized)
}

export function appendWikilink(content: string, target: string): string {
  const linkTarget = lintLinkTarget(target)
  if (hasWikilinkToTarget(content, linkTarget)) return content
  const linkLine = `- [[${linkTarget}]]`
  const relatedHeading = /^##\s+Related\s*$/im.exec(content)
  if (relatedHeading) {
    const insertAt = relatedHeading.index + relatedHeading[0].length
    return `${content.slice(0, insertAt)}\n${linkLine}${content.slice(insertAt)}`
  }
  return `${content.trimEnd()}\n\n## Related\n${linkLine}\n`
}

export function rewriteWikilinkTarget(
  content: string,
  brokenTarget: string,
  suggestedTarget: string,
): string {
  const broken = normalizedLintLinkTarget(brokenTarget)
  const replacement = lintLinkTarget(suggestedTarget)
  return content.replace(
    /\[\[([^\]|]+?)(\|[^\]]+?)?\]\]/g,
    (match, rawTarget: string, rawAlias?: string) => {
      if (normalizedLintLinkTarget(rawTarget) !== broken) return match
      return `[[${replacement}${rawAlias ?? ""}]]`
    },
  )
}

export function stubRelativePathFromBrokenTarget(brokenTarget: string): string {
  const normalized = lintLinkTarget(brokenTarget)
  const parts = normalized
    .split("/")
    .map((part) => makeQuerySlug(part))
    .filter(Boolean)
  const rel = parts.length > 1
    ? parts.join("/")
    : `queries/${parts[0] ?? "missing-page"}`
  return `${rel}.md`
}

function stubTitleFromBrokenTarget(brokenTarget: string): string {
  return getFileName(lintLinkTarget(brokenTarget))
    .replace(/[-_]+/g, " ")
    .trim() || "Missing Page"
}

export async function ensureBrokenLinkStub(
  projectPath: string,
  brokenTarget: string,
): Promise<{ fullPath: string; relativePath: string; created: boolean }> {
  const relativePath = stubRelativePathFromBrokenTarget(brokenTarget)
  const fullPath = `${projectPath}/wiki/${relativePath}`
  if (await fileExists(fullPath)) {
    return { fullPath, relativePath, created: false }
  }

  const parent = fullPath.split("/").slice(0, -1).join("/")
  await createDirectory(parent)
  const title = stubTitleFromBrokenTarget(brokenTarget)
  const date = new Date().toISOString().slice(0, 10)
  const content = [
    "---",
    "type: query",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `created: ${date}`,
    `updated: ${date}`,
    "tags: [stub, lint]",
    "related: []",
    "sources: []",
    "---",
    "",
    `# ${title}`,
    "",
    "Created by Wiki Lint as a placeholder for a missing wikilink target.",
    "",
  ].join("\n")
  await writeFile(fullPath, content)
  return { fullPath, relativePath, created: true }
}
