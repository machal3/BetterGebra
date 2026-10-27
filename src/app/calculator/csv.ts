/**
 * A table pasted from a spreadsheet or read from a CSV file, as variables of the calculator: each column a vector
 * named after its header, the whole table a matrix `dane`. Pure. The separator is found in the text (a semicolon,
 * a tab, a comma or spaces); with a semicolon or a tab the decimal separator may be a comma, as Polish files have it.
 * Numbers stay as written (1,25 is 5/4 exactly), so the statistics of the data are exact.
 */
import type { Saved } from '../../cas/engine';
import { reserved } from '../../cas/parse';

export interface Column { name: string; values: string[] }
export interface Table { columns: Column[]; rows: number; header: boolean; separator: string; problems: string[] }

const MAX_ROWS = 5000, MAX_COLUMNS = 50, MAX_CODE = 60_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const SEPARATORS: Record<string, string> = { ';': 'średnik', '\t': 'tabulator', ',': 'przecinek', ' ': 'spacje' };

/** A cell as a number in the parser's notation (dot for decimals), or null. */
function number(cell: string, comma: boolean): string | null {
  let s = cell.replace(/\s| /g, '');
  if (comma) s = s.replace(',', '.');
  if (!NUMBER.test(s)) return null;
  return s.replace(/^\+/, '').replace(/^(-?)\./, '$10.');
}
const split = (line: string, sep: string) => (sep === ' ' ? line.trim().split(/\s+/) : line.split(sep)).map(c => c.trim().replace(/^"(.*)"$/, '$1'));

/** A header cell as a variable name: small letters, no diacritics, letters, digits and _. */
function nameOf(cell: string, k: number, taken: Set<string>): string {
  let s = cell.toLowerCase().replace(/[ąćęłńóśźż]/g, c => PL[c]).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^\d/.test(s)) s = `k${s}`;
  s = s.slice(0, 32) || `kol${k + 1}`;
  if (reserved(s)) s = `${s}_`;
  let name = s;
  for (let i = 2; taken.has(name); i++) name = `${s}${i}`;
  taken.add(name);
  return name;
}

export function parseTable(text: string, header?: boolean): Table {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const problems: string[] = [];
  if (lines.length > MAX_ROWS + 1) problems.push(`Biorę ${MAX_ROWS} pierwszych wierszy z ${lines.length}.`);
  const sample = lines.slice(0, 20).join('\n');
  const sep = sample.includes(';') ? ';' : sample.includes('\t') ? '\t' : sample.includes(',') ? ',' : ' ';
  const comma = sep !== ',';
  const cells = lines.slice(0, MAX_ROWS + 1).map(l => split(l, sep));
  if (!cells.length) return { columns: [], rows: 0, header: false, separator: SEPARATORS[sep], problems: ['Brak danych.'] };
  // a first row with something that is not a number names the columns
  const hasHeader = header ?? cells[0].some(c => c !== '' && number(c, comma) === null);
  const body = hasHeader ? cells.slice(1) : cells;
  const width = Math.min(MAX_COLUMNS, Math.max(...cells.map(r => r.length)));
  if (Math.max(...cells.map(r => r.length)) > MAX_COLUMNS) problems.push(`Biorę ${MAX_COLUMNS} pierwszych kolumn.`);
  const taken = new Set<string>(['dane']);
  const columns: Column[] = [];
  for (let k = 0; k < width; k++) {
    const name = nameOf(hasHeader ? cells[0][k] ?? '' : '', k, taken);
    const values: string[] = [];
    let bad = '';
    body.forEach((r, i) => {
      const n = number(r[k] ?? '', comma);
      if (n === null && !bad) bad = (r[k] ?? '') === '' ? `brak wartości w wierszu ${i + 1 + (hasHeader ? 1 : 0)}` : `„${r[k]}” w wierszu ${i + 1 + (hasHeader ? 1 : 0)} to nie liczba`;
      if (n !== null) values.push(n);
    });
    if (bad) { problems.push(`Pomijam kolumnę ${name}: ${bad}.`); continue; }
    if (values.length) columns.push({ name, values });
  }
  return { columns, rows: body.length, header: hasHeader, separator: SEPARATORS[sep], problems };
}

const preview = (xs: string[]) => xs.slice(0, 12).join(', ') + (xs.length > 12 ? ', …' : '');
/** The table's columns as vectors and, with two or more of them, the whole table as the matrix `dane`. */
export function tableVariables(t: Table): { vars: Record<string, Saved>; problems: string[] } {
  const vars: Record<string, Saved> = {}, problems: string[] = [];
  for (const c of t.columns) {
    const code = `[${c.values.join(', ')}]`;
    if (code.length > MAX_CODE) { problems.push(`Kolumna ${c.name} jest za długa, by ją zapamiętać.`); continue; }
    vars[c.name] = { kind: 'list', code, label: `wektor 1×${c.values.length}`, preview: `[${preview(c.values)}]` };
  }
  const cols = t.columns.filter(c => vars[c.name] && c.values.length === t.rows);
  if (cols.length >= 2) {
    const code = `[${Array.from({ length: t.rows }, (_, i) => cols.map(c => c.values[i]).join(', ')).join('; ')}]`;
    if (code.length <= MAX_CODE) vars.dane = { kind: 'matrix', code, label: `macierz ${t.rows}×${cols.length}`, preview: `[${Array.from({ length: Math.min(4, t.rows) }, (_, i) => cols.slice(0, 6).map(c => c.values[i]).join(' ')).join('; ')}${t.rows > 4 ? '; …' : ''}]` };
    else problems.push('Cała tabela jest za duża na jedną macierz; zapisuję same kolumny.');
  }
  return { vars, problems };
}
