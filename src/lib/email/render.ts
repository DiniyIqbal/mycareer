/**
 * Fills {{variable}} placeholders in a message template (PRD §8, HR-07).
 * Unknown variables are left visible so a broken template is noticed in
 * testing rather than silently sending blanks.
 */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}
