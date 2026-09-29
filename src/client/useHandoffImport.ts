import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Batch } from '../shared/model';
import { api, errorText } from './api';

export function useHandoffImport(
  projectId: string | undefined,
  refresh: () => Promise<void>,
  reviewFolder?: string,
) {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function importFile(selected?: File) {
    if (!selected || !projectId || pending.current) return;
    pending.current = true;
    setImporting(true);
    setError('');
    try {
      if (selected.size > 8 * 1024 * 1024)
        throw new Error(
          'Choose a handoff JSON file under 8 MB. Video files stay in your footage folder.',
        );
      const handoff = JSON.parse(await selected.text());
      if (handoff.kind === 'batch-update')
        throw new Error('Open the existing batch and choose Import batch update for this file.');
      if (reviewFolder !== undefined) handoff.reviewFolder = reviewFolder;
      const batch = await api<Batch>(`/projects/${projectId}/import`, {
        method: 'POST',
        body: handoff,
      });
      await refresh();
      navigate(`/projects/${projectId}/batches/${batch.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      pending.current = false;
      setImporting(false);
    }
  }

  return { importing, error, importFile };
}
