import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type ServerEvent, type ServerOptions, type SourceLocation } from '../../lib/api'

export type ServerState =
  | { status: 'stopped' }
  | { status: 'starting' }
  | { status: 'running'; url: string }
  | { status: 'failed'; error: unknown }

export interface LogLine {
  id: number
  level: 'error' | 'warn' | 'info'
  text: string
  location: SourceLocation | null
}

const MAX_LOG_LINES = 500

/** Controls the `hugo server` process and collects its output. */
export function usePreviewServer() {
  const [state, setState] = useState<ServerState>({ status: 'stopped' })
  const [logs, setLogs] = useState<LogLine[]>([])
  const currentId = useRef<number | null>(null)
  const nextLogId = useRef(0)

  useEffect(() => {
    let disposed = false
    const unlisten = api.onServerEvent((event: ServerEvent) => {
      if (disposed) return
      if (event.type === 'log') {
        const line: LogLine = {
          id: nextLogId.current++,
          level: event.level,
          text: event.text,
          location: event.location,
        }
        setLogs((previous) => [...previous.slice(-(MAX_LOG_LINES - 1)), line])
      } else if (event.type === 'exited' && event.serverId === currentId.current) {
        // Late `exited` events from a replaced server carry an older id and are ignored.
        currentId.current = null
        setState({ status: 'stopped' })
      }
    })
    return () => {
      disposed = true
      void unlisten.then((stop) => stop())
    }
  }, [])

  const start = useCallback(async (options: ServerOptions) => {
    setState({ status: 'starting' })
    try {
      const status = await api.serverStart(options)
      currentId.current = status.serverId
      setState({ status: 'running', url: status.url })
    } catch (error) {
      currentId.current = null
      setState({ status: 'failed', error })
    }
  }, [])

  const stop = useCallback(async () => {
    currentId.current = null
    await api.serverStop()
    setState({ status: 'stopped' })
  }, [])

  const clearLogs = useCallback(() => setLogs([]), [])

  return { state, logs, start, stop, clearLogs }
}
