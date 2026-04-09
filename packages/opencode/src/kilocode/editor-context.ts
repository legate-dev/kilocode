export interface EditorContext {
  visibleFiles?: string[]
  openTabs?: string[]
  activeFile?: string
  shell?: string
  timezone?: string
}

/**
 * Build additional <env> lines from VS Code editor context.
 * Returns an array of pre-formatted `  key: value` strings.
 *
 * PATCH 6 — Cache-stable system prompt (upstream: anomalyco/opencode#5224)
 *
 * Dynamic content (date/time, activeFile, visibleFiles, openTabs) is stripped
 * from the system prompt to preserve Anthropic prompt cache prefix stability.
 * Every change to the system prompt busts the cache and forces full-price
 * reprocessing of the entire context window. Only static env info is emitted.
 *
 * The model already knows the date (training cutoff / API metadata), and
 * editor state is available via tool results when actually needed.
 */
export function editorContextEnvLines(ctx?: EditorContext): string[] {
  const lines: string[] = []
  if (ctx?.shell) {
    lines.push(`  Default shell: ${ctx.shell}`)
  }
  if (ctx?.timezone) {
    lines.push(`  User timezone: ${ctx.timezone}`)
  }
  return lines
}
