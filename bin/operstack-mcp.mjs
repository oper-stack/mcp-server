#!/usr/bin/env node
/** Точка входа MCP-сервера OperStack. Общение идёт по stdio, поэтому сюда нельзя печатать
 *  ничего своего: любая посторонняя строка в stdout ломает протокол. */
import { run } from '../src/server.mjs';

run().catch((e) => {
  process.stderr.write(`operstack-mcp failed to start: ${e.message}\n`);
  process.exit(1);
});
