# Bettergebra

Polskojęzyczny kalkulator wykresów: funkcje y = f(x), trygonometria, kolorowanie płaszczyzny zespolonej i zbiory liczb zespolonych. Do ośmiu funkcji naraz, parametry z suwakami, badanie funkcji z dokładnymi wartościami, eksport PNG.

## Uruchomienie

Wymaga Node.js 20 lub nowszego.

```
npm install
npm run dev        # http://localhost:5173
npm test           # testy silnika matematycznego (Vitest)
npm run build      # sprawdzenie typów + statyczne pliki w dist/
npm run preview    # podgląd zbudowanej wersji
```

Deploy na Vercel: zaimportuj repozytorium (konfiguracja w `vercel.json`) albo `npx vercel --prod`.

## Zapis

Potęgi `^` i `x²`, mnożenie bez znaku (`2x`, `3(x+1)`, `2pix`), `|x|`, `x!`, stopnie `30°`. Funkcje: `sin cos tg ctg sec csc`, `arcsin arccos arctg arcctg` (też `sin^-1`), `sinh cosh tanh coth` i odwrotne, `sqrt √ cbrt ∛ root(n; x)`, `ln log lg log_2(x) exp`, `abs sgn floor ceil round`, `min max mod` (argumenty po średniku), `Γ`, `Re Im arg conj`. Stałe `pi π e tau phi`. Działa też LaTeX (`\frac{1}{x}`, `\sqrt[3]{x}`). Każda inna litera to parametr z suwakiem. Parser nie wykonuje kodu z pola tekstowego.

W trybie **Zespolone** `z` (albo `x`) to zmienna, a `i` to jednostka urojona. W **Wykresach** obok funkcji każdy wiersz może być zbiorem: warunki i równania w x i y to krzywe i obszary (`x^2 + y^2 = 25`, `y > x^2`, `x = 2`), a z `z` albo `i` — zbiory liczb zespolonych: warunki (`|z − 1| <= 2`, `1 < Re z < 3`), równania (`z^2 = -1`) albo liczby z niewiadomymi (`t + 2i` to krzywa, `a + bi` to obszar). Zakres niewiadomych ustawia się w ustawieniach wiersza.

## Kalkulator

Panel **Kalkulator** (`#kalkulator`, link do wyniku: `#kalkulator?q=…`) to kalkulator symboliczny w stylu WolframAlpha. Jedna linijka wejścia, wyniki jako karty:

- **Liczby dokładne**: ułamki i potęgi na BigInt, pierwiastki (√12 = 2√3), π, e, i, wartości funkcji w szczególnych punktach (sin(π/5), arctg(2 − √3) = π/12, Γ(7/2), ζ(4)). Postać dziesiętna w arytmetyce dowolnej precyzji (do 5000 cyfr, `N(x, 100)`) — pokazywane są tylko cyfry, które wyszły tak samo przy dwóch różnych precyzjach.
- **Algebra**: upraszczanie, rozwijanie, rozkład na czynniki nad ℚ (także wielomiany wielu zmiennych jednorodne), ułamki proste, równania wielomianowe dokładnie (wzory kwadratowe, Cardano/Viète, dwukwadratowe, xⁿ = c), pozostałe numerycznie; równania przestępne z rodzinami rozwiązań (k ∈ ℤ), układy równań, nierówności i dziedzina jako sumy przedziałów.
- **Analiza**: pochodne, całki nieoznaczone (sprawdzane różniczkowaniem) i oznaczone (sprawdzane kwadraturą, z wykrywaniem rozbieżności), granice (szeregi Laurenta, reguła de l'Hospitala, kontrola numeryczna), szeregi Taylora, sumy i iloczyny, badanie przebiegu zmienności funkcji, styczne.
- **Macierze, teoria liczb, statystyka**: wyznacznik, odwrotna, rząd, wartości i wektory własne; rozkład na czynniki pierwsze (Pollard–Brent, test BPSW), NWD/NWW, φ, CRT, potęgi modulo; średnia, mediana, wariancja.

Polecenia działają po angielsku i po polsku (`całka x^2 od 0 do 1`, `granica sin(x)/x przy x->0`, `rozłóż 360`). Silnik działa w Web Workerze z limitem 20 s.

## Jak to działa

- `src/math`: parser do AST, kompilacja do funkcji rzeczywistych i zespolonych, MathML, analiza numeryczna (miejsca zerowe, ekstrema, końce przedziałów, zera zespolone z zasady argumentu) i arytmetyka dokładna. Wartość pokazana bez znaku ≈, np. (1 + √5)/2 albo π/4, jest sprawdzona ponownie w ułamkach BigInt, pierwiastkach kwadratowych i wielokrotnościach π.
- `src/analysis`: miejsca zerowe, przecięcia i dowody liczone w Web Workerze, więc przesuwanie i przybliżanie nie przycina się.
- `src/render`: wykresy na canvasie z adaptacyjnym próbkowaniem (asymptoty, skoki, kropki pełne i puste na końcach). Kolorowanie płaszczyzny zespolonej liczy WebGL2. Przy bardzo dużym przybliżeniu albo bez WebGL2 robi to CPU.
- `src/cas`: silnik kalkulatora — `q.ts` (ułamki BigInt), `expr.ts` (wyrażenia w postaci kanonicznej), `functions.ts` (wartości dokładne), `bigfloat.ts`/`numeric.ts` (dowolna precyzja), `poly.ts`, `calculus.ts`, `integrate.ts`, `solve.ts`, `matrix.ts`, `ntheory.ts`, `sums.ts`, `engine.ts` (karty wyników), `parse.ts`/`sugar.ts` (wejście).
- `src/state.ts`: jeden stan aplikacji. Zmiany są rozsyłane do subskrybentów i zapisywane w localStorage. Stan z v1 wczytuje się automatycznie.

Miejsca zerowe i przecięcia są szukane numerycznie w widocznym zakresie. Próbkowanie może pominąć bardzo szybkie oscylacje.
