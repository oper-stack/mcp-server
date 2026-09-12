/**
 * MCP-сервер OperStack.
 *
 * Простым языком. Это надстройка, которая даёт Claude, Cursor и любому другому клиенту MCP
 * измерить сайт так, как его читают поисковик и ИИ: сколько текста они видят, есть ли карта для
 * агентов, куда ведут ссылки в ней, и что мешает вас процитировать. Вы спрашиваете ассистента
 * обычными словами, он сам зовёт нужную проверку и отвечает по её результатам.
 *
 * Что важно: ничего не хранится, аккаунт не нужен, и ни одна цифра не берётся из платного сервиса.
 * Всё, что здесь считается, посчитано из того, что любой посторонний читает на сайте бесплатно.
 *
 * Технически: stdio-сервер на официальном SDK. Инструменты тонкие, вся работа в @operstack/audit,
 * том же пакете, на котором сделаны платные отчёты. Поэтому цифра, которую увидит здесь человек,
 * совпадает с цифрой в отчёте, за который платят: расхождение между бесплатным и платным
 * инструментом это худший способ потерять доверие.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { collect, localiseChecks, AREAS_RU } from '@operstack/audit';
import { checkLlms, normaliseSite } from './llms.mjs';

export const VERSION = '0.1.0';

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/** Компактная сводка аудита: клиенту не нужен весь JSON на сорок проверок, ему нужен вывод. */
function summarise(audit, lang) {
  const ru = lang === 'ru';
  const checks = ru ? localiseChecks(audit.checks || [], 'ru') : (audit.checks || []);
  const areaName = (k) => (ru ? (AREAS_RU[k] || k) : k);
  const open = checks.filter((c) => c.status === 'bad' || c.status === 'warn');
  return {
    site: audit.meta?.site,
    reachable: audit.meta?.reachable !== false,
    collectedAt: audit.meta?.collectedAt,
    pagesSampled: (audit.sample || []).filter((p) => p.title !== undefined).length,
    scores: Object.fromEntries(Object.entries(audit.scores || {}).map(([k, v]) => [areaName(k), v ?? (ru ? 'не измерялось' : 'not measured')])),
    failing: checks.filter((c) => c.status === 'bad').map((c) => ({ check: c.label, found: c.value })),
    needsAttention: checks.filter((c) => c.status === 'warn').map((c) => ({ check: c.label, found: c.value })),
    passing: checks.filter((c) => c.status === 'ok').length,
    openCount: open.length,
    note: ru
      ? 'Каждая цифра посчитана из того, что любой посторонний читает на сайте бесплатно. Ничего не сохранено.'
      : 'Every figure is computed from what any stranger can read on the site for nothing. Nothing was stored.',
  };
}

export function buildServer() {
  const server = new McpServer({ name: 'operstack', version: VERSION });

  server.registerTool(
    'audit_site',
    {
      title: 'Audit a site the way a search engine and an AI read it',
      description:
        'Read a public site and score six areas out of ten: technical SEO, content and structure, AEO (whether an answer engine can quote it), GEO (whether AI systems can identify and use it), off-page trust, and conversion. Returns every failing and borderline check with what was actually found on the pages. Free public signals only: no account, no paid tool, nothing stored. Use it when someone asks why a site is not being cited, why AI assistants recommend competitors, or what to fix first.',
      inputSchema: {
        url: z.string().describe('The site to read, for example example.com or https://example.com/'),
        pages: z.number().int().min(1).max(40).optional().describe('How many pages to sample from the sitemap. Default 12; more pages take longer.'),
        lang: z.enum(['en', 'ru']).optional().describe('Language of the check names and findings. Default en.'),
      },
    },
    async ({ url, pages = 12, lang = 'en' }) => {
      let site;
      try { site = normaliseSite(url); } catch (e) { return fail(e.message); }
      try {
        const audit = await collect(site, { pages, lang, rendered: false, log: () => {} });
        if (audit.meta?.reachable === false) return fail(`${site} did not answer. Check the address: a report about a site that is not there would be invented.`);
        return text(summarise(audit, lang));
      } catch (e) {
        return fail(`could not read ${site}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'check_llms_txt',
    {
      title: 'Check the llms.txt map a site offers to AI',
      description:
        'Read a site\'s /llms.txt, check it against the format (one H1 naming the site, a summary, sections of links) and follow its links to see whether each still leads to a page, a redirect or nothing. This file rots silently because no human ever opens it. Use it when someone asks whether their llms.txt is correct, why an assistant quotes the wrong pages, or before publishing a new one.',
      inputSchema: {
        url: z.string().describe('The site to check, for example example.com'),
        maxLinks: z.number().int().min(1).max(50).optional().describe('How many links to follow. Default 20.'),
      },
    },
    async ({ url, maxLinks = 20 }) => {
      try { return text(await checkLlms(url, { maxLinks })); }
      catch (e) { return fail(e.message); }
    },
  );

  server.registerTool(
    'run_gates',
    {
      title: 'Run the sixteen OperStack content gates on a local project',
      description:
        'Run the sixteen quality gates on a folder of Markdown or MDX content on this machine: cut titles, copied paragraphs, hollow sections, dead links, redirect chains, a stale agent index, figures with no source, and the agent surface. Returns the report. Use it before publishing, or when asked what is wrong with a content corpus. It needs a local path, not a URL, and it reads files without sending them anywhere.',
      inputSchema: {
        path: z.string().describe('Absolute path to the project folder that holds the content'),
        only: z.string().optional().describe('Comma-separated gate numbers to run, for example 1,4,16. Default all.'),
      },
    },
    async ({ path: dir, only }) => {
      if (!existsSync(dir)) return fail(`no such folder: ${dir}`);
      const args = ['--yes', '@operstack/gates'];
      if (only) args.push('--only', only);
      const r = spawnSync('npx', args, { cwd: dir, encoding: 'utf8', timeout: 10 * 60 * 1000, env: process.env });
      const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
      if (!out) return fail(`the gates produced no output in ${dir}. Is there a content folder there?`);
      return text(out);
    },
  );

  server.registerTool(
    'compare_sites',
    {
      title: 'Compare a site with its rivals on the same measurements',
      description:
        'Run the same six-area measurement on two to four public sites and return them side by side. Use it when someone asks why a competitor is being quoted instead of them, or wants to know where the gap actually is rather than guessing. Free public signals only.',
      inputSchema: {
        urls: z.array(z.string()).min(2).max(4).describe('The sites to compare. The first one is treated as yours.'),
        pages: z.number().int().min(1).max(20).optional().describe('Pages to sample per site. Default 8.'),
        lang: z.enum(['en', 'ru']).optional(),
      },
    },
    async ({ urls, pages = 8, lang = 'en' }) => {
      const rows = [];
      for (const raw of urls) {
        let site;
        try { site = normaliseSite(raw); } catch (e) { rows.push({ site: raw, error: e.message }); continue; }
        try {
          const audit = await collect(site, { pages, lang, rendered: false, log: () => {} });
          if (audit.meta?.reachable === false) { rows.push({ site, error: 'did not answer' }); continue; }
          const ru = lang === 'ru';
          rows.push({
            site,
            scores: Object.fromEntries(Object.entries(audit.scores || {}).map(([k, v]) => [ru ? (AREAS_RU[k] || k) : k, v ?? null])),
            openCount: (audit.checks || []).filter((c) => c.status !== 'ok').length,
          });
        } catch (e) { rows.push({ site, error: e.message }); }
      }
      return text({ yours: rows[0]?.site, comparison: rows, note: 'Same measurement on every site, taken from the outside. Nothing stored.' });
    },
  );

  return server;
}

export async function run() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
