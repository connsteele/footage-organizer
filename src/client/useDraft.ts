import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { editOf, type Batch } from '../shared/model';
import { api, errorText } from './api';
import { registerPendingSave } from './lifecycle';
interface History {
  past: Batch[];
  present: Batch;
  future: Batch[];
}
type Action =
  | { type: 'edit'; batch: Batch }
  | { type: 'undo' | 'redo' }
  | { type: 'revision'; revision: number };
export function draftReducer(state: History, action: Action): History {
  if (action.type === 'edit')
    return { past: [...state.past.slice(-49), state.present], present: action.batch, future: [] };
  if (action.type === 'revision')
    return { ...state, present: { ...state.present, revision: action.revision } };
  if (action.type === 'undo' && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    };
  if (action.type === 'redo' && state.future.length)
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  return state;
}
export function useDraft(projectId: string, initial: Batch) {
  const [history, dispatch] = useReducer(draftReducer, { past: [], present: initial, future: [] });
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const current = useRef(initial);
  const revision = useRef(initial.revision);
  const generation = useRef(0);
  const saved = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  current.current = history.present;
  const flush = useCallback(async () => {
    if (saving.current) {
      await saving.current;
    }
    if (saved.current === generation.current) return;
    const work = async () => {
      try {
        while (saved.current < generation.current) {
          setStatus('saving');
          const started = generation.current;
          const edit = editOf(current.current);
          edit.revision = revision.current;
          const result = await api<Batch>(`/projects/${projectId}/batches/${initial.id}`, {
            method: 'PUT',
            body: edit,
          });
          revision.current = result.revision;
          saved.current = started;
          dispatch({ type: 'revision', revision: result.revision });
        }
        setError('');
        setStatus('saved');
      } catch (e) {
        setError(errorText(e));
        setStatus('error');
        throw e;
      }
    };
    saving.current = work();
    try {
      await saving.current;
    } finally {
      saving.current = null;
    }
  }, [initial.id, projectId]);
  useEffect(() => registerPendingSave(flush), [flush]);
  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 650);
    return () => clearTimeout(timer);
  }, [history.present, status, flush]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (saved.current < generation.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => {
      window.removeEventListener('beforeunload', prevent);
    };
  }, []);
  function change(update: (batch: Batch) => void) {
    const batch = structuredClone(current.current);
    update(batch);
    current.current = batch;
    generation.current++;
    dispatch({ type: 'edit', batch });
    setStatus('pending');
  }
  function historyAction(type: 'undo' | 'redo') {
    if (type === 'undo' ? !history.past.length : !history.future.length) return;
    current.current = draftReducer(history, { type }).present;
    generation.current++;
    dispatch({ type });
    setStatus('pending');
  }
  return {
    batch: history.present,
    status,
    error,
    change,
    flush,
    undo: () => historyAction('undo'),
    redo: () => historyAction('redo'),
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
  };
}
