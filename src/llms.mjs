/**
 * Проверка llms.txt: тот же разбор, что на oper-stack.com, только без браузера.
 *
 * Простым языком: llms.txt это список ваших страниц, написанный для программ. Ассистент читает его
 * вместо того, чтобы обходить весь сайт. Файл ставят один раз и забывают, а сайт живёт дальше, и
 * через полгода половина ссылок ведёт в никуда. Человек этого не замечает, потому что этот адрес не
 * открывает никто.
 */
const UA = 'Mozilla/5.0 (compatible; OperStackMCP/0.1; +https://oper-stack.com/products/mcp/)';

const LINK_RE = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*:?\s*(.*)$/;
const BARE_RE = /^\s*[-*]\s*(https?:\/\/\S+|\/\S+)\s*(?:[:—–-]\s*(.*))?$/;

export function parseLlms(text) {
  const lines = String(text || '').split(/\r?\n/);
  let title = null; let summary = null;
  const sections = []; const links = []; let bare = 0;
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !title) { title = h1[1].trim(); continue; }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) { sections.push(h2[1].trim()); continue; }
    const q = /^>\s*(.+)$/.exec(line);
    if (q && !summary) { summary = q[1].trim(); continue; }
    const m = LINK_RE.exec(line);
    if (m) { links.push({ title: m[1].trim(), url: m[2].trim() }); continue; }
    const b = BARE_RE.exec(line);
    if (b) { bare++; links.push({ title: (b[2] || '').trim() || '(no title)', url: b[1].trim() }); }
  }
  return { title, summary, sections, links, bare };
}

export function normaliseSite(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('give the address of a site');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme && !/^https?$/i.test(scheme[1])) throw new Error('only http and https addresses work');
  const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) throw new Error(`that does not look like a domain name: ${u.hostname}`);
  // Зарезервированные имена ловим и с конца: internal.localhost и box.local проходят проверку на
  // домен, но всегда указывают внутрь машины или сети.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(u.hostname)
    || /\.(localhost|local|internal|test|example|invalid|home|lan|intranet)$/i.test(u.hostname)) {
    throw new Error('a local address is not reachable from the outside');
  }
  return u.origin;
}

async function head(url, ms) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(ms) });
    if (r.status === 405 || r.status === 501) {
      const g = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(ms) });
      return { status: g.status, location: g.headers.get('location') || undefined };
    }
    return { status: r.status, location: r.headers.get('location') || undefined };
  } catch { return { status: null }; }
}

export async function checkLlms(site, { maxLinks = 20, timeoutMs = 8000 } = {}) {
  const origin = normaliseSite(site);
  const url = `${origin}/llms.txt`;
  let text = null; let status = null;
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    status = r.status;
    if (r.ok) text = await r.text();
  } catch { /* нет ответа */ }

  if (text === null) {
    return {
      site: origin, url, found: false, status,
      verdict: 'missing',
      findings: [{ level: 'fail', message: status ? `no file at ${url}: the server answered ${status}` : `${url} did not answer` }],
      links: [],
    };
  }

  const p = parseLlms(text);
  const findings = [];
  if (!p.title) findings.push({ level: 'fail', message: 'no H1 naming the site on the first line, which the format requires' });
  else findings.push({ level: 'ok', message: `names the site: ${p.title}` });
  if (!p.summary) findings.push({ level: 'warn', message: 'no blockquote summary under the heading' });
  if (!p.sections.length) findings.push({ level: 'warn', message: 'no sections grouping the links' });
  if (!p.links.length) findings.push({ level: 'fail', message: 'lists no links at all' });
  else if (p.bare === p.links.length) findings.push({ level: 'warn', message: `all ${p.links.length} links are bare addresses; the format asks for [title](address) so a reader knows what is behind each one` });
  else if (p.bare) findings.push({ level: 'warn', message: `${p.bare} of ${p.links.length} links are bare addresses` });

  const sample = p.links.slice(0, maxLinks);
  const checked = await Promise.all(sample.map(async (l) => {
    let abs = l.url;
    try { abs = new URL(l.url, `${origin}/`).href; } catch { /* как есть */ }
    const r = await head(abs, Math.min(4000, timeoutMs));
    return { title: l.title, url: abs, status: r.status, ...(r.location ? { redirectsTo: new URL(r.location, abs).href } : {}) };
  }));
  const dead = checked.filter((l) => l.status === null || l.status >= 400);
  const moved = checked.filter((l) => l.status !== null && l.status >= 300 && l.status < 400);
  if (dead.length) findings.push({ level: 'fail', message: `${dead.length} of ${checked.length} checked links lead nowhere` });
  if (moved.length) findings.push({ level: 'warn', message: `${moved.length} of ${checked.length} checked links redirect` });
  if (checked.length && !dead.length && !moved.length) findings.push({ level: 'ok', message: `all ${checked.length} checked links answer directly` });

  let full = false;
  try { full = (await fetch(`${origin}/llms-full.txt`, { method: 'HEAD', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(3000) })).ok; } catch { /* нет */ }
  if (full) findings.push({ level: 'ok', message: 'llms-full.txt is there too' });

  const fails = findings.filter((f) => f.level === 'fail').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  return {
    site: origin, url, found: true, bytes: text.length,
    title: p.title, summary: p.summary, sections: p.sections,
    linksListed: p.links.length, linksChecked: checked.length, hasFullText: full,
    verdict: fails ? 'broken' : warns ? 'needs work' : 'good',
    findings, links: checked,
  };
}
