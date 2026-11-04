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
  // 20% is 20/100, "15% z 80" is 15% of 80; "12 mod 5" and "10 nad 3" (10 choose 3) as calls
  const operand = String.raw`(\d+(?:\.\d+)?|[a-z]\w*(?:\([^()]*\))?|\([^()]*\))`;
  // "100 + 20%" adds 20% of 100, as calculators do
  s = s.replace(/^(.+?)\s*([+-])\s*(\d+(?:[.,]\d+)?)\s*%\s*$/, (_, a: string, op: string, p: string) => `(${a})*(1 ${op} ${p.replace(',', '.')}/100)`)
    .replace(/(\d+(?:[.,]\d+)?)\s*%\s*(?:z|of)\s+(.+)$/i, (_, p: string, x: string) => `${p.replace(',', '.')}/100*(${x})`)
    .replace(/(\d+(?:[.,]\d+)?)\s*%(?=\s*(?:$|[-+*/^)=<>,;]))/g, (_, p: string) => `(${p.replace(',', '.')}/100)`)
    .replace(new RegExp(`${operand}\\s+mod\\s+${operand}`, 'gi'), 'mod($1, $2)')
    .replace(new RegExp(`${operand}\\s+(?:choose|nad)\\s+${operand}`, 'gi'), 'binomial($1, $2)');
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [new RegExp(`^d\\^?(\\d)?\\s*/\\s*d${W}\\^?\\d?\\s*(.+)$`, 'i'), m => `diff(${m[3]}, ${m[2]}${m[1] ? `, ${m[1]}` : ''})`],
    [new RegExp(`^(?:pochodna|derivative|rozniczkuj|differentiate)\\s+(?:rzedu\\s+(\\d+)\\s+)?(?:z |of |funkcji )?(.+?)(?:\\s+(?:po|wzgledem|wrt|with respect to|by)\\s+${W})?$`, 'i'), m => `diff(${m[2]}${m[3] ? `, ${m[3]}` : ''}${m[1] ? `${m[3] ? '' : ', x'}, ${m[1]}` : ''})`],
    [/^(?:∫|integrate|integral|calka|calkuj)\s*_\s*\{?([^}^]+?)\}?\s*\^\s*\{?([^}\s]+?)\}?\s+(.+?)\s*d([a-z])\s*$/i, m => `integrate(${m[3]}, ${m[4]}, ${m[1]}, ${m[2]})`],
    [new RegExp(`^(?:calka|calkuj|integrate|integral|int|∫)\\s+(?:z |of )?(?:funkcji\\s+)?(?:(?:oznaczona|nieoznaczona|definite|indefinite)\\s+)?(.+?)\\s*(?:d${W})?\\s+(?:od|from)\\s+(.+?)\\s+(?:do|to)\\s+(.+)$`, 'i'), m => `integrate(${m[1]}, ${m[2] ?? 'x'}, ${m[3]}, ${m[4]})`],
    // "całka od 0 do 1 x^2 dx": the limits first
    [new RegExp(`^(?:calka|calkuj|integrate|integral|int|∫)\\s+(?:oznaczona\\s+|definite\\s+)?(?:od|from)\\s+(\\S+)\\s+(?:do|to)\\s+(\\S+)\\s+(?:z\\s+|of\\s+)?(?:funkcji\\s+)?(.+?)(?:\\s*d${W})?\\s*$`, 'i'), m => `integrate(${m[3]}, ${m[4] ?? 'x'}, ${m[1]}, ${m[2]})`],
    [new RegExp(`^(?:calka|calkuj|integrate|integral|int|∫)\\s+(?:z |of )?(?:funkcji\\s+)?(?:nieoznaczona\\s+|indefinite\\s+)?(.+?)\\s*d${W}\\s*$`, 'i'), m => `integrate(${m[1]}, ${m[2]})`],
    [new RegExp(`^(?:calka|calkuj|integrate|integral|int|∫)\\s+(?:(?:z|of)\\s+)?funkcji\\s+(?:nieoznaczona\\s+|indefinite\\s+)?(?!\\()(.+)$`, 'i'), m => `integrate(${m[1]})`],
    [new RegExp(`^(?:lim|limit|granica)\\s+${W}\\s*->\\s*([^\\s]+?)(, ?-?1)?\\s+(.+)$`, 'i'), m => `limit(${m[4]}, ${m[1]}->${m[2]}${m[3] ?? ''})`],
    [new RegExp(`^(?:lim|limit|granica)\\s+(?:z |of )?(?:funkcji\\s+)?(.+?)\\s*(?:,|przy|gdy|dla|as|when|for)\\s+${W}\\s*(?:->|dazy do|do|to)\\s*(.+)$`, 'i'), m => `limit(${m[1]}, ${m[2]}->${m[3]})`],
    [new RegExp(`^(?:szereg|series|taylor|rozwiniecie|maclaurin)\\s+(?:taylora\\s+|maclaurina\\s+)?(?:funkcji\\s+)?(.+?)(?:\\s+(?:w|wokol|at|around|przy|dla|in)\\s+(?:punkcie\\s+)?${W}\\s*=\\s*([^\\s]+))?(?:\\s+(?:do|rzedu|stopnia|to order|order|do rzedu)\\s+(\\d+))?$`, 'i'),
      m => `taylor(${m[1]}${m[2] ? `, ${m[2]}, ${m[3]}` : ''}${m[4] ? `${m[2] ? '' : ', x, 0'}, ${m[4]}` : ''})`],
    [/^(?:miejsca\s+zerowe|zera|pierwiastki|roots|zeros)\s+(?:funkcji\s+|wielomianu\s+)?(?!\()(.+)$/i, m => `roots(${m[1]})`],
    [/^(?:rozwiaz|solve)\s+(?:uklad\s+|rownanie\s+|nierownosc\s+|system\s+)?(.+?)(?:\s+(?:dla|wzgledem|for)\s+([a-z](?:\s*,\s*[a-z])*))?$/i, m => `solve(${m[1].includes(',') && !/^[[{]/.test(m[1]) ? `{${m[1]}}` : m[1]}${m[2] ? `, {${m[2]}}` : ''})`],
    [/^(?:rozloz|faktoryzuj|factor|factorize)\s+(?:na czynniki\s+(?:pierwsze\s+)?)?(.+)$/i, m => `factor(${m[1]})`],
    [/^(?:rozwin|wymnoz|expand)\s+(.+)$/i, m => `expand(${m[1]})`],
    [/^(?:uprosc|simplify)\s+(.+)$/i, m => `simplify(${m[1]})`],
    [/^(?:czy\s+)?(\d+)\s+(?:jest\s+)?(?:liczba\s+)?pierwsz[aey]?\s*\??$/i, m => `isprime(${m[1]})`],
    [/^is\s+(\d+)\s+(?:a\s+)?prime\s*\??$/i, m => `isprime(${m[1]})`],
    [/^(?:badanie|zbadaj|przebieg|analyze|analiza)\s+(?:przebiegu\s+)?(?:zmiennosci\s+)?(?:funkcji\s+)?(.+)$/i, m => `analyze(${m[1]})`],
    [/^(?:ekstrema|extrema)\s+(?:lokalne\s+)?(?:funkcji\s+)?(?!\()(.+)$/i, m => `extrema(${m[1]})`],
    [/^(?:plaszczyzna\s+styczna|tangent\s+plane)\s+(?:do\s+|to\s+)?(?:powierzchni\s+|funkcji\s+)?(.+?)\s+(?:w\s+punkcie|w|at)\s+(.+)$/i, m => `tangentplane(${m[1]}, ${m[2]})`],
    [/^(?:styczna|tangent)\s+(?:do\s+|to\s+)?(?:wykresu\s+)?(?:funkcji\s+)?(.+?)\s+(?:w punkcie|w|at)\s+(?:x\s*=\s*)?(.+)$/i, m => `tangent(${m[1]}, ${m[2]})`],
    [/^(?:gradient|grad)\s+(?:z\s+|of\s+)?(?:funkcji\s+)?(?!\()(.+?)(?:\s+(?:w\s+punkcie|w|at)\s+(.+))?$/i, m => `gradient(${m[1]}${m[2] ? `, ${m[2]}` : ''})`],
    [/^(?:dywergencja|divergence)\s+(?:z\s+|of\s+)?(?:pola\s+)?(?!\()(.+)$/i, m => `divergence(${m[1]})`],
    [/^(?:rotacja|curl)\s+(?:z\s+|of\s+)?(?:pola\s+)?(?!\()(.+)$/i, m => `curl(${m[1]})`],
    [/^(?:potencjal|potential)\s+(?:z\s+|of\s+)?(?:pola\s+)?(?!\()(.+)$/i, m => `potential(${m[1]})`],
    [/^(?:laplasjan|laplacian)\s+(?:z\s+|of\s+)?(?:funkcji\s+)?(?!\()(.+)$/i, m => `laplacian(${m[1]})`],
    [/^(?:jakobian|macierz\s+jacobiego|jacobian)\s+(?:z\s+|of\s+)?(?:funkcji\s+|przeksztalcenia\s+|pola\s+)?(?!\()(.+)$/i, m => `jacobian(${m[1]})`],
    [/^(?:hesjan|macierz\s+hessego|hessian)\s+(?:z\s+|of\s+)?(?:funkcji\s+)?(?!\()(.+?)(?:\s+(?:w\s+punkcie|w|at)\s+(.+))?$/i, m => `hessian(${m[1]}${m[2] ? `, ${m[2]}` : ''})`],
    [/^(?:dlugosc\s+luku|arc\s+length)\s+(?:krzywej\s+|funkcji\s+)?(?!\()(.+?)\s+(?:od|from)\s+(\S+)\s+(?:do|to)\s+(\S+)$/i, m => `arclength(${m[1]}, ${m[2]}, ${m[3]})`],
    [/^(?:krzywizna|curvature)\s+(?:krzywej\s+|funkcji\s+)?(?!\()(.+?)(?:\s+(?:w\s+punkcie|w|dla|at)\s+(?:[a-z]\s*=\s*)?(.+))?$/i, m => `curvature(${m[1]}${m[2] ? `, ${m[2]}` : ''})`],
    [/^(?:wronskian)\s+(?:funkcji\s+|ukladu\s+)?(?!\()(.+)$/i, m => `wronskian(${m[1]})`],
    [/^(?:odwrotna\s+transformata\s+laplace(?:'?a)?|inverse\s+laplace(?:\s+transform)?)\s+(?:z\s+|of\s+)?(?:funkcji\s+)?(?!\()(.+)$/i, m => `ilaplace(${m[1]})`],
    [/^(?:transformata\s+laplace(?:'?a)?|laplace\s+transform)\s+(?:z\s+|of\s+)?(?:funkcji\s+)?(?!\()(.+)$/i, m => `laplace(${m[1]})`],
    [/^(?:odwrotna\s+transformata\s+z|inverse\s+z\s+transform)\s+(?:z\s+|of\s+)?(?!\()(.+)$/i, m => `iztrans(${m[1]})`],
    [/^(?:transformata\s+z|z\s+transform)\s+(?:z\s+|of\s+)?(?!\()(.+)$/i, m => `ztrans(${m[1]})`],
    [/^(?:szereg\s+fouriera|fourier\s+series)\s+(?:z\s+|of\s+)?(?:funkcji\s+)?(?!\()(.+)$/i, m => `fourierseries(${m[1]})`],
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

