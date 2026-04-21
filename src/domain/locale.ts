import { MESSAGES, type MessageId } from "./messages";

export type LocaleMessages = Record<string, string>;

export function msg(
  id: MessageId,
  vars: Record<string, string> = {},
  localeMessages: LocaleMessages = {},
): string {
  const englishTemplate = MESSAGES[id];
  const template = localeMessages[id] ?? englishTemplate ?? id;

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? `{{${key}}}`);
}
