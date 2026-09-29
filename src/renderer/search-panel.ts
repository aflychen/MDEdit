import { Facet } from '@codemirror/state'
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from '@codemirror/view'
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search'
import { text, type Language, type MessageKey } from '../shared/language'

export const searchLanguage = Facet.define<Language, Language>({ combine: values => values[0] ?? 'en' })

function element<K extends keyof HTMLElementTagNameMap>(name: K, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(name)
  if (className) item.className = className
  return item
}

function actionButton(action: string, label: string, icon?: string): HTMLButtonElement {
  const button = element('button', 'md-search-button')
  button.type = 'button'
  button.dataset.action = action
  button.textContent = icon ?? label
  button.setAttribute('aria-label', label)
  button.title = label
  return button
}

function option(name: string): { label: HTMLLabelElement; input: HTMLInputElement; caption: HTMLSpanElement } {
  const label = element('label', 'md-search-option')
  const input = element('input')
  input.type = 'checkbox'
  input.name = name
  const caption = element('span')
  label.append(input, caption)
  return { label, input, caption }
}

export class DocumentSearchPanel implements Panel {
  readonly dom = element('div', 'md-search-panel')
  readonly top = true
  private readonly findField = element('input', 'md-search-input')
  private readonly replaceField = element('input', 'md-search-input')
  private readonly previous = actionButton('previous', '', '↑')
  private readonly next = actionButton('next', '', '↓')
  private readonly close = actionButton('close', '', '×')
  private readonly caseOption = option('case')
  private readonly regexpOption = option('regexp')
  private readonly wordOption = option('word')
  private readonly replaceToggle = actionButton('toggle-replace', '')
  private readonly replaceRow = element('div', 'md-search-row md-search-replace-row')
  private readonly replaceOne = actionButton('replace', '')
  private readonly replaceEvery = actionButton('replace-all', '')
  private readonly error = element('span', 'md-search-error')
  private query: SearchQuery
  private language: Language
  private expanded = false

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state)
    this.language = view.state.facet(searchLanguage)
    this.dom.setAttribute('role', 'search')
    this.findField.type = 'text'
    this.findField.name = 'find'
    this.findField.setAttribute('main-field', 'true')
    this.findField.autocomplete = 'off'
    this.replaceField.type = 'text'
    this.replaceField.name = 'replace'
    this.replaceField.autocomplete = 'off'
    this.error.setAttribute('role', 'status')
    this.error.setAttribute('aria-live', 'polite')

    const findRow = element('div', 'md-search-row md-search-find-row')
    const actions = element('div', 'md-search-actions')
    actions.append(this.previous, this.next, this.close)
    findRow.append(this.findField, actions)
    const options = element('div', 'md-search-options')
    options.append(this.caseOption.label, this.regexpOption.label, this.wordOption.label, this.replaceToggle)
    const replaceActions = element('div', 'md-search-actions md-search-replace-actions')
    replaceActions.append(this.replaceOne, this.replaceEvery)
    this.replaceRow.append(this.replaceField, replaceActions)
    this.dom.append(findRow, options, this.replaceRow, this.error)

    this.findField.addEventListener('input', () => this.commit())
    this.replaceField.addEventListener('input', () => this.commit())
    for (const item of [this.caseOption, this.regexpOption, this.wordOption]) item.input.addEventListener('change', () => this.commit())
    this.previous.addEventListener('click', () => findPrevious(this.view))
    this.next.addEventListener('click', () => findNext(this.view))
    this.close.addEventListener('click', () => closeSearchPanel(this.view))
    this.replaceToggle.addEventListener('click', () => {
      this.expanded = !this.expanded
      this.refresh()
      if (this.expanded) this.replaceField.focus()
    })
    this.replaceOne.addEventListener('click', () => replaceNext(this.view))
    this.replaceEvery.addEventListener('click', () => replaceAll(this.view))
    this.dom.addEventListener('keydown', event => this.keydown(event))
    this.refresh()
  }

  mount(): void { this.findField.select() }

  update(_update: ViewUpdate): void {
    this.query = getSearchQuery(this.view.state)
    this.language = this.view.state.facet(searchLanguage)
    this.refresh()
  }

  private commit(): void {
    const previous = this.query
    const query = new SearchQuery({
      search: this.findField.value,
      replace: this.replaceField.value,
      caseSensitive: this.caseOption.input.checked,
      regexp: this.regexpOption.input.checked,
      wholeWord: this.wordOption.input.checked,
      literal: previous.literal,
      test: previous.test
    })
    if (!query.eq(previous)) {
      this.query = query
      this.view.dispatch({ effects: setSearchQuery.of(query) })
    }
    this.refresh()
  }

  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault()
      return
    }
    if (event.key !== 'Enter') return
    if (event.target === this.findField) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    } else if (event.target === this.replaceField) {
      event.preventDefault()
      replaceNext(this.view)
    }
  }

  private label(key: MessageKey): string { return text(this.language, key) }

  private refresh(): void {
    const label = (target: HTMLButtonElement, key: MessageKey, icon?: string) => {
      const value = this.label(key)
      target.textContent = icon ?? value
      target.setAttribute('aria-label', value)
      target.title = value
    }
    this.dom.setAttribute('aria-label', this.label('search.find'))
    this.findField.setAttribute('aria-label', this.label('search.find'))
    this.findField.placeholder = this.label('search.find')
    this.replaceField.setAttribute('aria-label', this.label('search.replaceInput'))
    this.replaceField.placeholder = this.label('search.replaceInput')
    label(this.previous, 'search.previous', '↑')
    label(this.next, 'search.next', '↓')
    label(this.close, 'search.close', '×')
    label(this.replaceToggle, this.expanded ? 'search.hideReplace' : 'search.showReplace')
    label(this.replaceOne, 'search.replace')
    label(this.replaceEvery, 'search.replaceAll')
    this.replaceToggle.setAttribute('aria-expanded', String(this.expanded))
    this.replaceRow.hidden = !this.expanded
    this.caseOption.caption.textContent = this.label('search.matchCase')
    this.regexpOption.caption.textContent = this.label('search.regexp')
    this.wordOption.caption.textContent = this.label('search.wholeWord')
    const query = this.query
    if (this.findField.value !== query.search) this.findField.value = query.search
    if (this.replaceField.value !== query.replace) this.replaceField.value = query.replace
    this.caseOption.input.checked = query.caseSensitive
    this.regexpOption.input.checked = query.regexp
    this.wordOption.input.checked = query.wholeWord
    const available = query.valid
    this.previous.disabled = !available
    this.next.disabled = !available
    this.replaceToggle.disabled = this.view.state.readOnly
    this.replaceField.disabled = this.view.state.readOnly
    this.replaceOne.disabled = !available || this.view.state.readOnly
    this.replaceEvery.disabled = !available || this.view.state.readOnly
    const invalid = query.search.length > 0 && query.regexp && !query.valid
    this.error.hidden = !invalid
    this.error.textContent = invalid ? this.label('search.invalidRegex') : ''
  }
}

export function createDocumentSearchPanel(view: EditorView): Panel {
  return new DocumentSearchPanel(view)
}
