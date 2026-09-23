#!/usr/bin/env node
/**
 * `npm run dev`: next dev on this app's port - 5049, its entry in the tsunagi-m-stack port ledger -
 * unless PORT names another.
 *
 * PORT is how the desktop app's preview pane hands a dev server a free port when the ledger's is
 * taken, typically by another worktree of this repository running its own dev server. A hardcoded
 * `-p 5049` made that second server fail to start instead. Each worktree has its own .next, so a
 * second port is all a second server needs (the NEXT_DIST_DIR split in tsunagi-m-stack section 2
 * is for two servers in ONE checkout, which this is not).
 *
 * Without PORT this is exactly the old `next dev -p 5049`. Dropping the flag instead would not do:
 * Next's own default is 3000, which the ledger gives to tsunagi-m3.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const LEDGER_PORT = '5049';
const port = process.env.PORT?.trim() || LEDGER_PORT;
const next = createRequire(import.meta.url).resolve('next/dist/bin/next');

const child = spawn(process.execPath, [next, 'dev', '-p', port, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
