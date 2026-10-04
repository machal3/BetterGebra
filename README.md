# Bettergebra

Polskojęzyczny kalkulator wykresów funkcji z interaktywnym płótnem, porównywaniem do ośmiu funkcji, eksportem PNG i podstawowymi obliczeniami numerycznymi.

Uruchomienie: `npm run dev`, następnie http://localhost:5173. Wymaga Node.js 20 lub nowszego. Bez instalowania zależności.

`npm test` sprawdza parser matematyczny oraz wyszukiwanie miejsc zerowych. `npm run build` przygotowuje statyczne pliki w katalogu `dist`. Deploy na Vercel: zaimportuj repozytorium (konfiguracja w `vercel.json`) albo uruchom `npx vercel --prod`.

Obsługiwane: potęgi `^`, mnożenie domyślne `2x`, stałe `pi` i `e`, funkcje `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sqrt`, `abs`, `ln`, `log` (dziesiętny), `exp`, `floor`, `ceil`. Kąty w radianach. Parser nie wykonuje kodu JavaScript z pola tekstowego.

Miejsca zerowe i przecięcia są szukane numerycznie w aktualnym zakresie X. Wartość pokazana bez znaku ≈ (np. (1 + √5)/2, π/4) jest sprawdzona: wyrażenie liczone jest ponownie w arytmetyce dokładnej (ułamki, pierwiastki kwadratowe, wielokrotności π). Wartości, których nie da się tak sprawdzić (np. ∛2, ln 2), mają znak ≈. Algorytm próbkowania może pominąć pierwiastki styczne i bardzo szybkie oscylacje. Wykres jest również próbkowany. Dane pozostają w pamięci przeglądarki do odświeżenia strony. Fonty pobierane są z Google Fonts, z systemowymi zamiennikami offline.
