import { newSession, type DocumentSession } from './session'

export interface TabWorkspace {
  tabs: DocumentSession[]
  activeId: number
}

export function initialWorkspace(): TabWorkspace {
  const session = newSession()
  return { tabs: [session], activeId: session.id }
}

export function activateTab(workspace: TabWorkspace, id: number): TabWorkspace {
  return workspace.tabs.some(tab => tab.id === id) ? { ...workspace, activeId: id } : workspace
}

export function openTab(workspace: TabWorkspace, session: DocumentSession): TabWorkspace {
  if (session.path !== null) {
    const existing = workspace.tabs.find(tab => tab.path === session.path)
    if (existing) return { ...workspace, activeId: existing.id }
  }
  return { tabs: [...workspace.tabs, session], activeId: session.id }
}

export function updateTab(
  workspace: TabWorkspace,
  id: number,
  updater: (session: DocumentSession) => DocumentSession
): TabWorkspace {
  const index = workspace.tabs.findIndex(tab => tab.id === id)
  if (index === -1) return workspace
  const tabs = workspace.tabs.slice()
  tabs[index] = updater(tabs[index])
  return { ...workspace, tabs }
}

export function replaceTab(workspace: TabWorkspace, id: number, session: DocumentSession): TabWorkspace {
  const index = workspace.tabs.findIndex(tab => tab.id === id)
  if (index === -1) return workspace
  const tabs = workspace.tabs.slice()
  tabs[index] = session
  return { tabs, activeId: workspace.activeId === id ? session.id : workspace.activeId }
}

export function closeTab(workspace: TabWorkspace, id: number): TabWorkspace {
  const index = workspace.tabs.findIndex(tab => tab.id === id)
  if (index === -1) return workspace

  const tabs = workspace.tabs.filter(tab => tab.id !== id)
  if (tabs.length === 0) return initialWorkspace()

  if (workspace.activeId !== id) return { tabs, activeId: workspace.activeId }
  const activeIndex = Math.min(index, tabs.length - 1)
  return { tabs, activeId: tabs[activeIndex].id }
}

export function tabIndexForKey(count: number, index: number, key: string): number | null {
  if (count < 1) return null
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
