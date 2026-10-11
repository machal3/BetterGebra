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

W trybie **Zespolone** `z` (albo `x`) to zmienna, a `i` to jednostka urojona. W trybie **Zbiory** wpisuje się warunki (`|z − 1| <= 2`, `1 < Re z < 3`), równania (`z^2 = -1`) albo liczby z niewiadomymi (`t + 2i` to krzywa, `a + bi` to obszar). Zakres niewiadomych ustawia się w ustawieniach funkcji.

## Jak to działa

- `src/math`: parser do AST, kompilacja do funkcji rzeczywistych i zespolonych, MathML, analiza numeryczna (miejsca zerowe, ekstrema, końce przedziałów, zera zespolone z zasady argumentu) i arytmetyka dokładna. Wartość pokazana bez znaku ≈, np. (1 + √5)/2 albo π/4, jest sprawdzona ponownie w ułamkach BigInt, pierwiastkach kwadratowych i wielokrotnościach π.
- `src/analysis`: miejsca zerowe, przecięcia i dowody liczone w Web Workerze, więc przesuwanie i przybliżanie nie przycina się.
- `src/render`: wykresy na canvasie z adaptacyjnym próbkowaniem (asymptoty, skoki, kropki pełne i puste na końcach). Kolorowanie płaszczyzny zespolonej liczy WebGL2. Przy bardzo dużym przybliżeniu albo bez WebGL2 robi to CPU.
- `src/state.ts`: jeden stan aplikacji. Zmiany są rozsyłane do subskrybentów i zapisywane w localStorage. Stan z v1 wczytuje się automatycznie.

Miejsca zerowe i przecięcia są szukane numerycznie w widocznym zakresie. Próbkowanie może pominąć bardzo szybkie oscylacje.
