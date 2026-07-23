#!/usr/bin/env node
import { main } from '../src/cli-v3.js';

main(process.argv.slice(2))
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((error) => {
    const message = error?.message || String(error);
    console.error(`crimson: ${message}`);
    if (process.env.CRIMSON_DEBUG) console.error(error?.stack || error);
    process.exit(1);
  });
