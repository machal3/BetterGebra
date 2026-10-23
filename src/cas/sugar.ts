/**
 * Phrases in Polish or English rewritten to command calls before parsing: "całka x^2 od 0 do 1" →
 * integrate(x^2, x, 0, 1). Kept apart from the engine so the page can show the interpretation while typing.
 */
import { fromLatex } from './latex';

const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
/** Phrases → command calls: "całka x^2 od 0 do 1" → integrate(x^2, x, 0, 1). LaTeX is translated first. */
export function sugar(raw: string): string {
  let s = fromLatex(raw.trim()).replace(/[ąćęłńóśźż]/gi, c => PL[c.toLowerCase()] ?? c).replace(/→|⟶/g, '->').replace(/\s+/g, ' ');
  if (/^\s*-?\d+,\d+\s*$/.test(s)) s = s.replace(',', '.'); // a lone Polish decimal
  s = s.replace(/^(oblicz|policz|ile wynosi|ile to|compute|evaluate|calculate|wylicz)\s*:?\s+/i, '');
  const W = '([a-zα-ω])';
  const normSide = (str: string) => str
    // 0+, 0^+, 0^(+), 0⁺; a bare ")" after the sign closes the call, it isn't part of (+)
    .replace(/->\s*([^,;)\s]+?)\s*(\^?(?:\(\+\)|\+)|⁺)\s*(?=$|[,;)\s])/g, '->$1, 1')
    .replace(/->\s*([^,;)\s]+?)\s*(\^?(?:\(-\)|-)|⁻)\s*(?=$|[,;)\s])/g, '->$1, -1');
  // x->0+ / x->0- : one-sided limits as a third argument
  s = normSide(s);
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [new RegExp(`^d\\^?(\\d)?\\s*/\\s*d${W}\\^?\\d?\\s*(.+)$`, 'i'), m => `diff(${m[3]}, ${m[2]}${m[1] ? `, ${m[1]}` : ''})`],
    [new RegExp(`^(?:pochodna|derivative|rozniczkuj|differentiate)\\s+(?:rzedu\\s+(\\d+)\\s+)?(?:z |of |funkcji )?(.+?)(?:\\s+(?:po|wzgledem|wrt|with respect to|by)\\s+${W})?$`, 'i'), m => `diff(${m[2]}${m[3] ? `, ${m[3]}` : ''}${m[1] ? `${m[3] ? '' : ', x'}, ${m[1]}` : ''})`],
    [/^(?:∫|integrate|integral|calka|calkuj)\s*_\s*\{?([^}^]+?)\}?\s*\^\s*\{?([^}\s]+?)\}?\s+(.+?)\s*d([a-z])\s*$/i, m => `integrate(${m[3]}, ${m[4]}, ${m[1]}, ${m[2]})`],
    [new RegExp(`^(?:calka|calkuj|integrate|integral|int|∫)\\s+(?:z |of )?(?:(?:oznaczona|nieoznaczona|definite|indefinite)\\s+)?(.+?)\\s*(?:d${W})?\\s+(?:od|from)\\s+(.+?)\\s+(?:do|to)\\s+(.+)$`, 'i'), m => `integrate(${m[1]}, ${m[2] ?? 'x'}, ${m[3]}, ${m[4]})`],
    [new RegExp(`^(?:calka|calkuj|integrate|integral|int|∫)\\s+(?:z |of )?(?:nieoznaczona\\s+|indefinite\\s+)?(.+?)\\s*d${W}\\s*$`, 'i'), m => `integrate(${m[1]}, ${m[2]})`],
    [new RegExp(`^(?:lim|limit|granica)\\s+${W}\\s*->\\s*([^\\s]+?)(, ?-?1)?\\s+(.+)$`, 'i'), m => `limit(${m[4]}, ${m[1]}->${m[2]}${m[3] ?? ''})`],
    [new RegExp(`^(?:lim|limit|granica)\\s+(?:z |of )?(.+?)\\s*(?:,|przy|gdy|dla|as|when|for)\\s+${W}\\s*(?:->|dazy do|do|to)\\s*(.+)$`, 'i'), m => `limit(${m[1]}, ${m[2]}->${m[3]})`],
    [new RegExp(`^(?:szereg|series|taylor|rozwiniecie|maclaurin)\\s+(?:taylora\\s+|maclaurina\\s+)?(?:funkcji\\s+)?(.+?)(?:\\s+(?:w|wokol|at|around|przy|dla|in)\\s+(?:punkcie\\s+)?${W}\\s*=\\s*([^\\s]+))?(?:\\s+(?:do|rzedu|stopnia|to order|order|do rzedu)\\s+(\\d+))?$`, 'i'),
      m => `taylor(${m[1]}${m[2] ? `, ${m[2]}, ${m[3]}` : ''}${m[4] ? `${m[2] ? '' : ', x, 0'}, ${m[4]}` : ''})`],
    [/^(?:rozwiaz|solve)\s+(?:uklad\s+|rownanie\s+|nierownosc\s+|system\s+)?(.+?)(?:\s+(?:dla|wzgledem|for)\s+([a-z](?:\s*,\s*[a-z])*))?$/i, m => `solve(${m[1].includes(',') && !/^[[{]/.test(m[1]) ? `{${m[1]}}` : m[1]}${m[2] ? `, {${m[2]}}` : ''})`],
    [/^(?:rozloz|faktoryzuj|factor|factorize)\s+(?:na czynniki\s+(?:pierwsze\s+)?)?(.+)$/i, m => `factor(${m[1]})`],
    [/^(?:rozwin|wymnoz|expand)\s+(.+)$/i, m => `expand(${m[1]})`],
    [/^(?:uprosc|simplify)\s+(.+)$/i, m => `simplify(${m[1]})`],
    [/^(?:czy\s+)?(\d+)\s+(?:jest\s+)?(?:liczba\s+)?pierwsz[aey]?\s*\??$/i, m => `isprime(${m[1]})`],
    [/^is\s+(\d+)\s+(?:a\s+)?prime\s*\??$/i, m => `isprime(${m[1]})`],
    [/^(?:badanie|zbadaj|przebieg|analyze|analiza)\s+(?:przebiegu\s+)?(?:zmiennosci\s+)?(?:funkcji\s+)?(.+)$/i, m => `analyze(${m[1]})`],
    [/^(?:styczna|tangent)\s+(?:do\s+|to\s+)?(?:wykresu\s+)?(?:funkcji\s+)?(.+?)\s+(?:w punkcie|w|at)\s+(?:x\s*=\s*)?(.+)$/i, m => `tangent(${m[1]}, ${m[2]})`],
    [/^(?:dziedzina|domain)\s+(?:funkcji\s+)?(.+)$/i, m => `domain(${m[1]})`],
    [/^(?:wykres[y]?|narysuj|rysuj|plot|graph)\s+(?:funkcji\s+|krzywej\s+)?(?!\()(.+)$/i, m => `plot(${m[1]})`],
    [/^(.+?)\s+(?:w systemie|in base|o podstawie|base)\s+(\d+)\s*$/i, m => `base(${m[1]}, ${m[2]})`],
    [/^(.+?)\s+(?:na|to|w)\s+(?:system\s+)?(dwojkowy|binarny|binary|szesnastkowy|hex|hexadecimal|osemkowy|octal)\s*$/i, m => `base(${m[1]}, ${/dwoj|bin/.test(m[2]) ? 2 : /szesn|hex/.test(m[2]) ? 16 : 8})`],
    [new RegExp(`^(.+?)\\s+(?:dla|gdzie|where|for|przy)\\s+${W}\\s*=\\s*(.+)$`, 'i'), m => `subst(${m[1]}, ${m[2]}, ${m[3]})`],
  ];
  for (const [re, f] of rules) {
    const m = s.match(re);
    if (m) return normSide(f(m));
  }
  return s;
}

