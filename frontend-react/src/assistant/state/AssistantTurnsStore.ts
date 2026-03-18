import { create } from 'zustand'
import type { AgentThread, AgentTurn, AgentToolEvent, StreamingEnvelope } from '../../shared/types/api'

interface AssistantTurnsState {
  activeThreadId: string | null
  threads: Record<string, AgentThread>
  turns: Record<string, AgentTurn>
}

interface AssistantTurnsActions {
  ensureThread: (payload: { threadId: string; agentId: string; title: string; contextSnapshotId: string; surfaceState: string }) => void
  applyEnvelope: (envelope: StreamingEnvelope) => void
  clearThread: (threadId?: string | null) => void
}

function now() {
  return new Date().toISOString()
}

function upsertToolEvent(toolEvents: AgentToolEvent[], nextEvent: AgentToolEvent) {
  const existingIndex = toolEvents.findIndex((event) => event.toolId === nextEvent.toolId)
  if (existingIndex === -1) {
    return [...toolEvents, nextEvent]
  }

  const nextToolEvents = [...toolEvents]
  nextToolEvents[existingIndex] = {
    ...nextToolEvents[existingIndex],
    ...nextEvent,
  }
  return nextToolEvents
}

export const useAssistantTurnsStore = create<AssistantTurnsState & AssistantTurnsActions>((set) => ({
  activeThreadId: null,
  threads: {},
  turns: {},
  ensureThread: ({ threadId, agentId, title, contextSnapshotId, surfaceState }) =>
    set((state) => {
      const existingThread = state.threads[threadId]
      return {
        activeThreadId: threadId,
        threads: {
          ...state.threads,
          [threadId]: existingThread || {
            id: threadId,
            agentId,
            title,
            createdAt: now(),
            updatedAt: now(),
            contextSnapshotId,
            surfaceState,
            turnIds: [],
          },
        },
      }
    }),
  clearThread: (threadId) =>
    set((state) => {
      if (!threadId) {
        return { activeThreadId: null, threads: {}, turns: {} }
      }

      const nextThreads = { ...state.threads }
      const nextTurns = { ...state.turns }
      const turnIds = nextThreads[threadId]?.turnIds || []
      delete nextThreads[threadId]
      for (const turnId of turnIds) {
        delete nextTurns[turnId]
      }

      return {
        activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
        threads: nextThreads,
        turns: nextTurns,
      }
    }),
  applyEnvelope: (envelope) =>
    set((state) => {
      const existingThread = state.threads[envelope.threadId] || {
        id: envelope.threadId,
        agentId: 'chat-agent',
        title: 'Assistant thread',
        createdAt: now(),
        updatedAt: now(),
        contextSnapshotId: envelope.threadId,
        surfaceState: 'active',
        turnIds: [],
      }

      const existingTurn = state.turns[envelope.turnId] || {
        id: envelope.turnId,
        threadId: envelope.threadId,
        role: 'assistant',
        source: 'encounter-runtime',
        scope: 'local',
        status: 'streaming',
        requestId: envelope.requestId,
        parts: [],
        summary: null,
        toolEvents: [],
        citations: [],
        error: null,
        startedAt: now(),
        completedAt: null,
      }

      let nextTurn = existingTurn

      if (envelope.event === 'turn.started') {
        nextTurn = {
          ...existingTurn,
          ...(envelope.data as unknown as AgentTurn),
        }
      }

      if (envelope.event === 'turn.delta') {
        const delta = String(envelope.data.delta || '')
        const currentText = nextTurn.parts.map((part) => part.text).join(' ')
        nextTurn = {
          ...nextTurn,
          status: 'streaming',
          parts: [{ type: 'text', text: [currentText, delta].filter(Boolean).join(' ').trim() }],
        }
      }

      if (envelope.event === 'turn.reasoning_summary') {
        nextTurn = {
          ...nextTurn,
          summary: JSON.stringify(envelope.data),
        }
      }

      if (envelope.event === 'turn.tool_started' || envelope.event === 'turn.tool_delta' || envelope.event === 'turn.tool_completed') {
        nextTurn = {
          ...nextTurn,
          toolEvents: upsertToolEvent(nextTurn.toolEvents, envelope.data as unknown as AgentToolEvent),
        }
      }

      if (envelope.event === 'turn.citation') {
        nextTurn = {
          ...nextTurn,
          citations: [...nextTurn.citations, envelope.data],
        }
      }

      if (envelope.event === 'turn.completed') {
        nextTurn = {
          ...nextTurn,
          ...(envelope.data as unknown as Partial<AgentTurn>),
          status: 'completed',
        }
      }

      if (envelope.event === 'turn.failed') {
        nextTurn = {
          ...nextTurn,
          status: 'failed',
          error: String(envelope.data.error || 'Assistant turn failed.'),
          completedAt: now(),
        }
      }

      if (envelope.event === 'turn.cancelled') {
        nextTurn = {
          ...nextTurn,
          status: 'cancelled',
          completedAt: now(),
        }
      }

      const nextThread: AgentThread = {
        ...existingThread,
        updatedAt: now(),
        turnIds: existingThread.turnIds.includes(envelope.turnId)
          ? existingThread.turnIds
          : [...existingThread.turnIds, envelope.turnId],
      }

      return {
        activeThreadId: envelope.threadId,
        threads: {
          ...state.threads,
          [envelope.threadId]: nextThread,
        },
        turns: {
          ...state.turns,
          [envelope.turnId]: nextTurn,
        },
      }
    }),
}))