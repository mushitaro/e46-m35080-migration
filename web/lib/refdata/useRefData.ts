'use client';

/**
 * One reference-data document for the UI: asked for once, the first time a screen wants it (in
 * the preview - elsewhere the answer is 'not-preview' with no request made), replaceable by a
 * file the reader opens, and in memory only. `state` is null while the request is in flight.
 *
 * Asked for ONCE: leaving the tab and coming back must not fetch again, and must not throw away
 * a file the reader opened in the meantime. RELOAD is the reader's, explicitly. The latest of a
 * request and a file wins: an answer that arrives after the reader opened a file is dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRefData, refFromFile, type RefLoad } from './load';
import type { RefName } from './types';

export function useRefData<N extends RefName>(name: N, wanted = true) {
  const [state, setState] = useState<RefLoad<N> | null>(null);
  const asked = useRef(false);
  const generation = useRef(0);

  const reload = useCallback(() => {
    asked.current = true;
    const mine = ++generation.current;
    setState(null);
    void loadRefData(name).then((r) => {
      if (generation.current === mine) setState(r);
    });
  }, [name]);

  useEffect(() => {
    if (wanted && !asked.current) reload();
  }, [wanted, reload]);

  const openFile = useCallback(
    async (file: { name: string; text(): Promise<string> }) => {
      asked.current = true;
      const mine = ++generation.current;
      const r = await refFromFile(name, file);
      if (generation.current === mine) setState(r);
    },
    [name],
  );

  return { state, reload, openFile };
}
