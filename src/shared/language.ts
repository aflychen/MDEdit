export type Language = 'en' | 'zh-CN'

const english = {
  'recovery.count': '{count} recoverable drafts'
}

const chinese: Record<keyof typeof english, string> = {
  'recovery.count': '{count} 份可恢复草稿'
}

export const messages: Record<Language, Record<keyof typeof english, string>> = {
  en: english,
  'zh-CN': chinese
}

export type MessageKey = keyof typeof english

export function parseLanguage(value: string | null): Language {
  return value === 'zh-CN' ? 'zh-CN' : 'en'
}

export function text(language: Language, key: MessageKey, values: Record<string, string | number> = {}): string {
  return messages[language][key].replace(/\{([a-zA-Z]+)\}/g, (_, name: string) => String(values[name] ?? '{' + name + '}'))
}
