/* global URL, console */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create, insert, save } from '@orama/orama';
import { parse, HTMLElement, type Node } from 'node-html-parser';
import { searchSchema } from '../src/utils/search-schema';

const indexes = new Map<string, ReturnType<typeof create<typeof searchSchema>>>();

/** Preserve spaces around inline text and boundaries between block elements. */
function plainText(node: Node): string {
  if (node.nodeType === 3) return node.text;
  if (!(node instanceof HTMLElement)) return '';
  // Some Markdown code blocks contain escaped Expressive Code markup.
  // Strip only that generated wrapper, preserving the actual code text.
  if (node.tagName === 'PRE' && node.text.startsWith('<code><div class="ec-line">')) {
    return plainText(parse(node.text)) + ' ';
  }
  const text = node.childNodes.map(plainText).join('');
  return /^(P|DIV|H[1-6]|LI|TR|TD|TH|PRE|BR|BLOCKQUOTE|SECTION)$/.test(node.tagName || '')
    ? text + ' '
    : text;
}

async function indexDirectory(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_orama') await indexDirectory(path);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    const html = parse(await readFile(path, 'utf8'));
    const article = html.querySelector('[data-search-document]');
    if (
      !article ||
      html.querySelector('meta[name="robots"]')?.getAttribute('content')?.includes('noindex')
    )
      continue;
    const locale = html.querySelector('html')?.getAttribute('lang') || 'en';
    const canonical = html.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (!canonical) throw new Error(`Missing canonical URL: ${path}`);
    const title = article.querySelector('h1')?.text.trim() || '';
    const body = article.querySelector('[data-search-content]');
    if (!body) continue;
    for (const ignored of body.querySelectorAll(
      'script, style, svg, [data-search-ignore], [data-pagefind-ignore], [aria-hidden="true"]',
    ))
      ignored.remove();
    // Preserve boundaries between blocks and inline elements before extracting plain text.
    const content = plainText(body).replace(/\s+/g, ' ').trim();
    let db = indexes.get(locale);
    if (!db) {
      db = create({
        schema: searchSchema,
        language: locale.startsWith('fr') ? 'french' : 'english',
      });
      indexes.set(locale, db);
    }
    await insert(db, { title, content, url: new URL(canonical).pathname });
  }
}

await indexDirectory('dist');
await mkdir('dist/_orama', { recursive: true });
for (const [locale, db] of indexes) {
  await writeFile(`dist/_orama/${locale.split('-')[0]}.json`, JSON.stringify(save(db)));
  console.log(`Orama: generated ${locale} search index`);
}
