import { createMissingWikiPage, writeFile } from "@/commands/fs"
import {
  ensureBrokenLinkStub,
  requestLintRepairSync,
  resolveLintRepairContext,
} from "@/lib/lint-fixes"

export async function createMissingWikiPageWithRepairBridge(
  projectPath: string,
  title: string,
  content?: string,
): Promise<string> {
  const context = await resolveLintRepairContext(projectPath)
  const pathShapedTarget = title.replace(/\\/g, "/").includes("/")

  if (context.bridge && pathShapedTarget) {
    const stub = await ensureBrokenLinkStub(context.mutationRoot, title)
    try {
      if (stub.created && content?.trim()) {
        await writeFile(stub.fullPath, content)
      }
    } finally {
      await requestLintRepairSync(context)
    }
    return `wiki/${stub.relativePath}`
  }

  const relativePath = await createMissingWikiPage(context.mutationRoot, title, content)
  if (context.bridge) {
    await requestLintRepairSync(context)
  }
  return relativePath
}
