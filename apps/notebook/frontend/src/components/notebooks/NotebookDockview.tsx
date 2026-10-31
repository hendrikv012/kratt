'use client'

import { createContext, useCallback, useContext, useRef } from 'react'
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import { SourcesColumn } from '../../app/(dashboard)/notebooks/components/SourcesColumn'
import { NotesColumn } from '../../app/(dashboard)/notebooks/components/NotesColumn'
import { ChatColumn } from '../../app/(dashboard)/notebooks/components/ChatColumn'
import { useNotebookDockviewStore } from '@/lib/stores/notebook-dockview-store'
import type { SourceListResponse } from '@/lib/types/api'
import type { NoteResponse } from '@/lib/types/api'
import type {
  ContextSelections,
  ContextMode,
  NoteContextMode,
} from '@/lib/types/notebook-context'
import type { SourceBulkAction, NoteContextDefault } from '@/lib/utils/source-context'

interface NotebookDockviewProps {
  notebookId: string
  notebookName?: string
  sources?: SourceListResponse[]
  sourcesLoading: boolean
  onRefreshSources?: () => void
  notes?: NoteResponse[]
  notesLoading: boolean
  contextSelections: ContextSelections
  onSourceContextModeChange: (sourceId: string, mode: ContextMode) => void
  onNoteContextModeChange: (noteId: string, mode: NoteContextMode) => void
  onBulkSourceContext: (action: SourceBulkAction) => void
  onBulkNoteContext: (action: NoteContextDefault) => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
}

// Panel components (registered once with DockviewReact) read live data via
// context rather than dockview's panel `params`: params get round-tripped
// through api.toJSON()/fromJSON() for layout persistence, which would try
// to serialize (and drop) function props like onRefresh. Context also keeps
// the component identities passed to DockviewReact stable across renders,
// so dockview doesn't treat them as new component types and remount panels
// every time the parent re-renders.
const NotebookDockviewContext = createContext<NotebookDockviewProps | null>(null)

function useNotebookDockviewContext() {
  const ctx = useContext(NotebookDockviewContext)
  if (!ctx) {
    throw new Error('Dockview panel rendered outside NotebookDockview')
  }
  return ctx
}

function SourcesPanel(_props: IDockviewPanelProps) {
  const ctx = useNotebookDockviewContext()
  return (
    <SourcesColumn
      sources={ctx.sources}
      isLoading={ctx.sourcesLoading}
      notebookId={ctx.notebookId}
      notebookName={ctx.notebookName}
      onRefresh={ctx.onRefreshSources}
      contextSelections={ctx.contextSelections.sources}
      onContextModeChange={ctx.onSourceContextModeChange}
      onBulkContextModeChange={ctx.onBulkSourceContext}
      hasNextPage={ctx.hasNextPage}
      isFetchingNextPage={ctx.isFetchingNextPage}
      fetchNextPage={ctx.fetchNextPage}
    />
  )
}

function NotesPanel(_props: IDockviewPanelProps) {
  const ctx = useNotebookDockviewContext()
  return (
    <NotesColumn
      notes={ctx.notes}
      isLoading={ctx.notesLoading}
      notebookId={ctx.notebookId}
      contextSelections={ctx.contextSelections.notes}
      onContextModeChange={ctx.onNoteContextModeChange}
      onBulkContextModeChange={ctx.onBulkNoteContext}
    />
  )
}

function ChatPanel(_props: IDockviewPanelProps) {
  const ctx = useNotebookDockviewContext()
  return (
    <ChatColumn
      notebookId={ctx.notebookId}
      contextSelections={ctx.contextSelections}
      sources={ctx.sources ?? []}
      sourcesLoading={ctx.sourcesLoading}
    />
  )
}

const components = {
  sources: SourcesPanel,
  notes: NotesPanel,
  chat: ChatPanel,
}

function buildDefaultLayout(api: DockviewApi) {
  const sourcesPanel = api.addPanel({
    id: 'sources',
    component: 'sources',
    title: 'Sources',
  })
  const notesPanel = api.addPanel({
    id: 'notes',
    component: 'notes',
    title: 'Notes',
    position: { referencePanel: sourcesPanel, direction: 'right' },
  })
  api.addPanel({
    id: 'chat',
    component: 'chat',
    title: 'Chat',
    position: { referencePanel: notesPanel, direction: 'right' },
  })
}

export function NotebookDockview(props: NotebookDockviewProps) {
  const apiRef = useRef<DockviewApi | null>(null)
  const { layout, setLayout } = useNotebookDockviewStore()

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api

      if (layout) {
        try {
          event.api.fromJSON(layout)
        } catch {
          // Saved layout didn't match the current panel set (e.g. after an
          // app update) - fall back to the default arrangement instead of
          // leaving an empty/broken dockview.
          buildDefaultLayout(event.api)
        }
      } else {
        buildDefaultLayout(event.api)
      }

      event.api.onDidLayoutChange(() => {
        setLayout(event.api.toJSON())
      })
    },
    [layout, setLayout]
  )

  return (
    <NotebookDockviewContext.Provider value={props}>
      <div className="flex-1 min-h-0 w-full">
        <DockviewReact
          className="dockview-theme-quiet-green h-full"
          components={components}
          onReady={handleReady}
        />
      </div>
    </NotebookDockviewContext.Provider>
  )
}
