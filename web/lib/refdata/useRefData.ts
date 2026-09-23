'use client';

/**
 * One reference-data document for the UI: asked for once (in the preview), replaceable by a file
 * the reader opens, and in memory only. `state` is null while the request is in flight.
 */

import { useCallback, useEffect, useState } from 'react';
import { loadRefData, refFromFile, type RefLoad } from './load';
import type { RefName } from './types';

export function useRefData<N extends RefName>(name: N, enabled = true) {
  const [state, setState] = useState<RefLoad<N> | null>(null);

  const reload = useCallback(() => {
    setState(null);
    void loadRefData(name).then(setState);
  }, [name]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const openFile = useCallback(
    async (file: { name: string; text(): Promise<string> }) => setState(await refFromFile(name, file)),
    [name],
  );

  return { state, reload, openFile };
}
