#!/usr/bin/env node
/**
 * Проверка сервера так, как его увидит клиент: поднимаем настоящий процесс, соединяемся по stdio,
 * спрашиваем список инструментов и зовём каждый. Проверять внутренние функции в обход протокола
 * бессмысленно: сломаться может именно стык.
 *
 *   npm test
 *   npm test -- --live     ещё и сходить на живой сайт (медленнее, нужна сеть)
 */
import { normaliseSite } from './llms.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const firstText = (r) => (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

async function main() {
  const client = new Client({ name: 'operstack-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [resolve(ROOT, 'bin/operstack-mcp.mjs')],
  }));

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  ok('сервер отвечает списком инструментов', tools.length > 0, `получено: ${names.join(', ')}`);
  ok('есть все четыре инструмента', ['audit_site', 'check_llms_txt', 'compare_sites', 'run_gates'].every((n) => names.includes(n)), names.join(', '));
  ok('у каждого инструмента есть описание', tools.every((t) => (t.description || '').length > 60), tools.filter((t) => (t.description || '').length <= 60).map((t) => t.name).join(', '));
  ok('у каждого инструмента есть схема входа', tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));

  // Отказы: их проверяем всегда, сеть для них не нужна.
  for (const bad of ['localhost', '127.0.0.1', '192.168.1.1', 'internal.localhost']) {
    const r = await client.callTool({ name: 'check_llms_txt', arguments: { url: bad } });
    ok(`внутренний адрес отвергнут: ${bad}`, r.isError === true && /(local address|domain name)/i.test(firstText(r)), firstText(r));
  }

  const scheme = await client.callTool({ name: 'audit_site', arguments: { url: 'ftp://example.com' } });
  ok('чужая схема отвергнута', scheme.isError === true && /http and https/i.test(firstText(scheme)), firstText(scheme));

  const nodir = await client.callTool({ name: 'run_gates', arguments: { path: '/no/such/folder/anywhere' } });
  ok('несуществующая папка отвергнута', nodir.isError === true && /no such folder/i.test(firstText(nodir)), firstText(nodir));

  if (LIVE) {
    const llms = await client.callTool({ name: 'check_llms_txt', arguments: { url: 'oper-stack.com', maxLinks: 5 } });
    const parsed = JSON.parse(firstText(llms));
    ok('живая проверка llms.txt нашла файл', parsed.found === true, firstText(llms).slice(0, 200));
    ok('живая проверка вернула вердикт', ['good', 'needs work', 'broken'].includes(parsed.verdict), parsed.verdict);

    const audit = await client.callTool({ name: 'audit_site', arguments: { url: 'oper-stack.com', pages: 3 } });
    const a = JSON.parse(firstText(audit));
    ok('живой аудит вернул оценки', a.scores && Object.keys(a.scores).length === 6, JSON.stringify(a.scores));
    ok('живой аудит отметил сайт достижимым', a.reachable === true);

    const dead = await client.callTool({ name: 'audit_site', arguments: { url: 'this-domain-does-not-exist-operstack-test.com', pages: 2 } });
    ok('мёртвый домен отвергнут, а не оценён', dead.isError === true && /did not answer/i.test(firstText(dead)), firstText(dead));
  } else {
    console.log('...  живые проверки пропущены (запустите с --live)');
  }

  await client.close();
  // ---- адрес, написанный по-человечески
  // 16.09.2026 живой пользователь сообщил, что check_llms_txt отвечает «файла нет» на сайте, где
  // файл есть: для этого инструмента адрес не приводился к корню, хотя для остальных приводился.
  // Люди пишут адрес как придётся, и разобрать написание это наша работа, а не их.
  for (const raw of ['oper-stack.com', 'www.oper-stack.com', 'https://oper-stack.com/products/gates/',
                     'https://oper-stack.com/llms.txt', 'HTTPS://Oper-Stack.com']) {
    const root = normaliseSite(raw);
    ok(`адрес приводится к корню: ${raw}`, root === 'https://oper-stack.com' || root === 'https://www.oper-stack.com', root);
  }

  if (failed) { console.error(`\n${failed} проверок упало`); process.exit(1); }
  console.log('\nсервер отвечает как положено');
}

main().catch((e) => { console.error(e); process.exit(1); });
