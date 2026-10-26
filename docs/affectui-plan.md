# Bettergebra → Affect UI: plan przebudowy

Stan na 2026-10-26. Zrzuty „przed”: `output/screens/before/` (5 rozmiarów × jasny/ciemny × 5 ekranów + 6 widoków szczegółowych, 62 pliki; katalog jest w `.gitignore`).

## 1. Rozpoznanie

**Stos.** Vite 8 + TypeScript 7, bez frameworka i bez zależności w runtime. Interfejs to ręcznie składany DOM: `index.html` (380 linii statycznego HTML z id) + moduły `src/ui/*.ts`, `src/geometry/panel.ts`, `src/main.ts`, które wiążą się z HTML przez `$('id')`. Style: jeden plik `src/styles/app.css` (1200 linii, tokeny Fluent 2). Deploy: Vercel, `framework: vite`, `npm run build` → `dist/`. Testy: Vitest (`tests/*.test.ts`), dotyczą silnika.

**Stan.** `src/state.ts`: jeden obiekt `state` + `commit(topics)` → subskrybenci per temat (raz na mikrozadanie). Zapis: `localStorage['bettergebra.v2']` (z migracją v1 `bettergebra`, trybów `set` i `trig`). Kalkulator: `localStorage['bettergebra.calc']` (historia, cyfry). Geometria: własne klucze w `panel.ts` (rysunek, widok, siatka/osie, ulubione narzędzia). Motyw: `state.theme` (`null` = systemowy), ustawiany przed pierwszym malowaniem skryptem w `<head>`.

**Uwaga do CLAUDE.md:** sekcja Architecture opisuje stare pliki (`math.js`, `app.js`, `server.js`, `build.js`), których już nie ma. Do poprawy przy okazji.

**Wniosek:** aplikacja nie jest w React 19 → potrzebna migracja (pkt 4).

## 2. Inwentarz UI (z kodu, nie tylko z opisu)

Pozycje oznaczone ★ nie były na liście w zadaniu.

**Ekran startowy:** logo, „Co chcesz dziś robić?”, 3 karty-linki (Wykresy, Geometria, Kalkulator) z ikoną i opisem.

**Nawigacja:** pionowy pasek (logo → strona główna, Wykresy, Zespolone, Geometria, Kalkulator; `aria-current`), na telefonie dolny pasek. Routing przez hash: `#`, `#wykresy`, `#geometria`, `#kalkulator`, ★`#kalkulator?q=…` (link do wyniku). ★Nagłówek panelu: Strona główna, tytuł, Pomoc, ★przełącznik motywu.

**Wykresy / Zespolone:**
- Lista funkcji (do 8, licznik „2 / 8”): kolorowa kropka = pokaż/ukryj★, pole z prefiksem `y =`/`f(z) =`, ★wzór złożony w MathML po wyjściu z pola, ★placeholdery zależne od trybu, błąd składni pod wierszem, ★opis dziedziny pod wierszem, ustawienia wiersza, Usuń.
- Klawisze w polu: Enter (nowa/następna), ↑ ↓, Backspace w pustym usuwa, Esc kończy edycję.
- Ustawienia wiersza (popover; na telefonie arkusz): Dziedzina / Zakres niewiadomych (od–do, stałe typu `pi/2`, nawiasy domknięty/otwarty, podgląd, błąd), ★Kolor (8 + własny), ★Linia (ciągła/przerywana/kropkowana, grubość suwak + liczba), ★Duplikuj, Usuń, ★„Zbadaj w kalkulatorze” / „Rozwiąż w kalkulatorze” / „Miejsca zerowe w kalkulatorze”.
- „Dodaj funkcję” z podpowiedzią Enter.
- Parametry: suwak + pole liczbowe na literę, zakres suwaka rośnie do wpisanej wartości, błąd pola, opis pustego stanu.
- Kanwa: przeciąganie, kółko, gest, ★odczyt współrzędnych pod kursorem (`#readout`), ★podpis zakresu `x ∈ […]  y ∈ […]`, klawisze na kanwie (strzałki, + − 0), Shift/Alt + kółko.
- Pasek narzędzi kanwy: Przybliż, Oddal, ★Dopasuj y (F), ★Równe osie 1:1, Przywróć widok, f′ = Badanie funkcji (B), Widok, ★Zapisz PNG.
- ★Panel Badanie: wzór aktywnej funkcji, f(0), f(1), miejsca zerowe / „Zbiór”, przecięcia, stopka „w widocznym zakresie”, Zamknij.
- Widok (popover): Siatka, Osie, Przyciąganie kursora; Etykiety osi x i y (Liczby / Wielokrotności π / Stopnie); Zakres x od–do, y od–do + błąd walidacji.
- Tryb Zespolone: kolorowanie płaszczyzny (WebGL2/CPU), wymusza równe osie.

**Kalkulator:**
- Pole wpisywania z przyciskiem Oblicz, ★podgląd MathML na żywo (lub błąd), ★pasek symboli (19 przycisków w 4 grupach, owijają zaznaczenie), Cyfry 15/25/50/100.
- ↑ ↓ w polu przywołują historię (z zachowaniem szkicu).
- ★Stan „Obliczanie…” + ★Przerwij; limit 20 s.
- ★Pusty stan: nagłówek „Kalkulator symboliczny” + zakładki 9 tematów + kafelki przykładów.
- Wyniki: ★„Wejście” (jak zrozumiano) + „Rozumiem jako…”, karty wyników (pierwsza wyróżniona), ★karta błędu, kopiuj jako tekst, ★przycisk „więcej” (kolejne zapytanie), ★długie liczby jako zawijany tekst.
- ★Wykresy w wynikach: kanwa z przesuwaniem/przybliżaniem/dwuklikiem/klawiszami, dymek, pasek (przybliż, oddal, przywróć, przyciąganie, PNG), legenda z ukrywaniem serii, lista punktów (podświetla i centruje), „Otwórz w Wykresach/Zespolonych”.
- Panel boczny: Historia (lista, klik ponawia, Wyczyść), Przykłady (9 zwijanych grup z licznikiem), „Zapis i polecenia” (tabela).

**Geometria:**
- Zakładki Tworzenie / Obiekty (★licznik obiektów).
- Tworzenie: ★wyszukiwarka narzędzi + „Nie ma takiego narzędzia”, ★Ulubione (gwiazdki, zapisywane), ~40 narzędzi w grupach z ikonami.
- ★Pasek podpowiedzi narzędzia nad kanwą.
- Obiekty: pole definicji + Dodaj + błąd, ★„Polecenia i sposoby definiowania” (zwijane), pusty stan, lista z definicjami edytowalnymi po kliknięciu.
- ★Inspektor zaznaczenia: nazwa, x/y (Enter zatwierdza, Esc cofa), notatka, błąd; ★Styl: kolor, grubość/rozmiar, linia, kształt punktu, wypełnienie, etykieta, Przywróć domyślny wygląd.
- ★Dialog pytania o wartość (długość, promień, kąt, skala, liczba boków) z Anuluj / OK i walidacją.
- Pasek: Cofnij, ★Ponów (Ctrl+Y, Ctrl+Shift+Z), Przybliż, Oddal, Przywróć widok, ★Kratka, ★Układ współrzędnych, ★PNG, ★Wyczyść (z toastem „Ctrl+Z przywraca”).
- Klawisze: Ctrl+Z, Delete/Backspace, Esc (najpierw porzuca wybrane punkty, potem wraca do Przesuń).

**Wspólne:** Pomoc (dialog: Zapis, Tryby, Skróty, uwaga o dokładności; zamykanie tłem i Esc; `?`), ★toasty (z akcją Cofnij), ★własne dymki zamiast `title`, ★motyw jasny/ciemny/systemowy.

## 3. Affect UI: co jest dostępne i co z tego wynika

Dokumentację przeczytałem z `llms-full.txt`, a kod komponentów pobrałem z rejestru (`/r/<slug>.json`) i przejrzałem. Serwera MCP nie dodawałem (`claude mcp add` zmienia Twoją konfigurację Claude Code); rejestr i dokumentacja wystarczyły.

- Darmowe, potrzebne tu: Button, Segmented Control, Filter Menu, Message Actions, Notification Stack, Smart Recommendation, Thinking Loader, Tips Panel, Tool Call Card (każdy też w wersji **Clean**: `<slug>-clean`), oraz Grid Background, Shimmer Loader, Text Reveal. Toaster, Command Menu, Thinking State, Combobox, Dialog itp. są Pro — nie używam i nie odtwarzam.
- **Ciemny motyw** komponentów działa tylko przez `.dark` / `data-theme="dark"` na przodku, nie przez `prefers-color-scheme`. Dziś przy motywie „systemowym” atrybutu nie ma → będę zawsze ustawiał rozstrzygnięty `data-theme` na `<html>` (także w skrypcie przed pierwszym malowaniem).
- **Napisy po angielsku są wpisane w komponenty** („Copy”, „Copied”, „Show all”, „Failed”, „Filters”, „Tips … done”, „Strong signal”…). Ponieważ shadcn kopiuje źródło do repo, przetłumaczę je na polski w samych plikach (zmiana treści, nie stylu ani ruchu) i zaznaczę każdą zmianę komentarzem.
- Język wizualny: Inter, 13 px / 500 w kontrolkach, promienie 6–8 px (karty 10–12), cienie „hairline 0.5px + 1–2 px”, ruch 90–220 ms `cubic-bezier(0.25, 0.9, 0.3, 1)`, akcent niebieski `rgba(0,96,226,…)` / `#4d8dff` w ciemnym, ikony 16 px linią 1.4 z zaokrąglonymi końcami.

## 4. Migracja do React 19

Propozycja: **zostaje Vite** (nie Next.js) — aplikacja jest statyczna, routing przez hash, Vercel bez zmian.

1. Zależności: `react@19`, `react-dom@19`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react` (6.x, wspiera Vite 8). Opcjonalnie `@fontsource-variable/inter` (patrz decyzje).
2. `tsconfig.json`: `"jsx": "react-jsx"`, `paths: { "@/*": ["./src/*"] }`; alias `@` w `vite.config.ts`; `components.json` z rejestrem `@affectui` → pliki trafiają do `src/components/ui`.
3. **Silnik bez zmian w logice:** `src/math`, `src/cas`, `src/analysis`, `src/render`, `src/geometry/construct.ts`, `src/geometry/commands.ts`, `src/model.ts`, `src/format.ts`, `src/state.ts` (z tymi samymi kluczami i formatem zapisu). Testy silnika muszą przechodzić bez zmian.
4. **Most stan → React:** hook `useStore(topics)` na `useSyncExternalStore`, subskrybujący tylko wybrane tematy z `state.ts`. Kanwy (`Scene`, geometria, wykresy kalkulatora) żyją w `ref` i rysują się przez `scene.request()` jak dziś — React nigdy nie renderuje ich ponownie. Ruch suwaka zmienia `state.params` + `commit('params')`, więc rysuje kanwa, a React odświeża tylko wiersz parametru.
5. **Rozdzielenie `geometry/panel.ts` (1205 linii):** logika narzędzi, wskaźnika, cofania i zapisu → `geometry/controller.ts` przeniesiona bez zmian, wystawiająca zdarzenia; widoki (narzędzia, lista, inspektor, dialog) → komponenty React. To najbardziej ryzykowny krok — robię go mechanicznie i porównuję zachowanie na checkliście.
6. `calculatorQuery()` przenoszę z `ui/function-list.ts` do modułu bez Reacta (np. `src/calculator-query.ts`), a test importuje go stamtąd.
7. Kanwa wykresów kalkulatora (`calc-plot.ts`): rysowanie i obsługa wskaźnika zostają; legenda, pasek i lista punktów przechodzą do Reacta.
8. Na końcu: usunięcie `src/ui/*.ts`, starego `app.css`, statycznego HTML z `index.html` (zostaje `<div id="root">` + skrypt motywu).

## 5. Mapowanie komponentów (po weryfikacji w dokumentacji)

| Element | Komponent | Uwagi |
|---|---|---|
| Przełącznik trybów | **Segmented Control** (standard, `tray`, ikony) | W górnym pasku; na telefonie `fullWidth` na dole. Strona główna = logo. |
| Liczby / π / Stopnie, Cyfry 15–100, Tworzenie / Obiekty, styl linii i kształt punktu w geometrii, nawias domknięty/otwarty | **Segmented Control (Clean)** | Tworzenie/Obiekty jako `kind="tabs"`. Cyfry zamiast `<select>`. |
| Wszystkie przyciski | **Button (Clean)** w panelach, **Button** na ekranie startowym i w dialogach | Oblicz i Dodaj z `loading`. |
| Ekran startowy | **Tips Panel** (standard) + **Text Reveal** (nagłówek) + **Grid Background** | Licznik „0/3 done” nie ma sensu → dodam prop, który go wyłącza. |
| Historia kalkulatora | **Tool Call Card (Clean)** jako wiersz | Nazwa = zapytanie, status/czas obliczenia, rozwinięcie = wynik w tekście. Klik „Ponów” liczy znowu. |
| Karty wyników | Własna karta w języku Tool Call Card (Clean) + **Message Actions (Clean)** (`actions={["copy","regenerate"]}`) | Tool Call Card nie renderuje MathML (wynik pokazuje jako tekst/JSON), więc treść wyników to własny komponent; liczby bez animacji. |
| „Obliczanie…” (do 20 s) | **Thinking Loader (Clean)** z fazami „Liczę” → „Sprawdzam numerycznie” → „Jeszcze chwilę” + Przerwij; **Shimmer Loader** jako szkielet kart | Fazy na zegarze, nie udają postępu. |
| Widok (Siatka/Osie/Przyciąganie) | Zwijane sekcje w stylu **Filter Menu (Clean)** | Sam Filter Menu to checkboxy filtrów z chipami „Filters / Clear all” — złe znaczenie dla przełączników i pól zakresu. Biorę jego anatomię (nagłówki grup z chevronem, wiersze), przełączniki i pola buduję sam. |
| Komunikaty (toasty, „Rysunek wyczyszczony… Cofnij”) | **Notification Stack (Clean)** w rogu kanwy, z automatycznym zamknięciem | Błędy składni **zostają przy polu** (`aria-describedby`, czytane od razu) — w stosie powiadomień byłyby oderwane od wiersza. |
| Podpowiedzi poleceń | **Smart Recommendation (Clean)** pod panelem Badanie: „Zbadaj w kalkulatorze” jako rekomendacja, alternatywy: miejsca zerowe, styczna w x₀, całka | Sygnał 0–3 zastąpię opisem bez „pewności” albo ukryję (prop lokalny). |
| Przykłady i polecenia, Pomoc | Karty i zwijane sekcje w stylu Affect UI; klik przykładu wstawia go i liczy | |
| Pusta historia, brak obiektów | Własny pusty stan z prostą ilustracją SVG w tym stylu | Darmowe ilustracje Affect UI to sceny SaaS (kalendarz, czat) — nie pasują do matematyki. |
| Suwaki, pola zakresu, przełączniki, pole wzoru, paski narzędzi kanwy, pasek narzędzi geometrii, dialog, popover, arkusz, dymek | Własne komponenty na tych samych tokenach | Dialogi na `<dialog>`, popovery na Popover API (jak dziś), więc Esc i focus trap działają natywnie. |

Ikony: jeden zestaw liniowy 16/20 px, linia 1.5, zaokrąglone końce (rysowane w stylu ikon Affect UI), w jednym module `src/components/icons.tsx`. Fluent Icons znikają.

## 6. Nowy układ

**Desktop (≥ 1024 px):** górny pasek 52 px: logo (strona główna) · Segmented Control trybów · po prawej Pomoc i motyw. Pod nim panel boczny 340 px + kanwa na resztę.
- *Wykresy:* panel = Funkcje, Parametry. Na kanwie: pływający pionowy pasek po prawej (przybliż, oddal, dopasuj y, 1:1, przywróć | f′, Widok, PNG); Widok jako popover z sekcjami Wyświetlanie / Etykiety osi / Zakres; Badanie jako karta w lewym dolnym rogu kanwy; podpis zakresu w prawym dolnym.
- *Kalkulator:* bez kanwy; środkowa kolumna 760 px z dużym polem na górze (główny punkt), pod nim pasek symboli i Cyfry; pusty stan = przykłady jako kafelki z zakładkami. Panel: Historia (Tool Call Card) i Przykłady/Zapis.
- *Geometria:* pływająca paleta narzędzi przy lewej krawędzi kanwy (ulubione + „Wszystkie narzędzia” z wyszukiwarką i grupami w popoverze), pasek akcji u góry kanwy (cofnij, ponów | widok | kratka, osie | PNG, wyczyść), podpowiedź narzędzia na dole kanwy. Panel = lista obiektów z polem definicji; inspektor jako karta przy prawej krawędzi kanwy.

**Tablet (768–1023 px):** jak desktop, ale panel jest szufladą (przycisk w górnym pasku), domyślnie otwartą w poziomie i zamkniętą w pionie.

**Telefon (< 768 px):** górny pasek tylko z logo, tytułem i menu; tryby w dolnym pasku (Segmented Control `fullWidth`, ikony + krótkie etykiety, 44 px+, nad paskiem domowym iPhone’a). Panel to wysuwany arkusz z uchwytem (zwinięty: pierwszy wiersz; połowa; pełny). Pasek narzędzi kanwy staje się poziomy i przewijany. `viewport-fit=cover` + `env(safe-area-inset-*)`. Poziomo: arkusz z boku.

## 7. Ryzyka

1. **Rozdzielenie `geometry/panel.ts`** — logika i DOM są przemieszane. Łagodzenie: przenoszenie bez przepisywania, testy `geometry*.test.ts` + ręczna checklista.
2. **Re-rendery a 60 fps** — kanwy poza cyklem Reacta, subskrypcje per temat; sprawdzę w Performance, że przeciąganie nie renderuje Reacta.
3. **Skróty** — globalne `keydown` zostają na `document` z tymi samymi warunkami; komponenty (Segmented Control łapie ← →, Home, End) tylko gdy mają fokus. Sprawdzę, że strzałki na kanwie i ↑ ↓ w polach działają.
4. **MathML i fonty** — Inter dla interfejsu, wzory dalej w Cambria Math / STIX.
5. **Kontrast** — część szarości Affect UI (np. `rgba(0,0,0,.447)` ikon) jest blisko granicy AA 3:1 dla elementów nietekstowych; sprawdzę axe/Lighthouse i podniosę lokalnie, jeśli trzeba.
6. **Rozmiar** — React dokłada ~60 kB gzip; silnik CAS i tak dominuje.

## 8. Etapy (każdy kończy się `npm run build`, `npm test`, przejściem checklisty w przeglądarce)

(a) infrastruktura React + alias + motyw/tokeny + most stanu, aplikacja dalej działa w starym UI · (b) nawigacja, górny/dolny pasek, ekran startowy · (c) Wykresy + Widok + Badanie + ustawienia wiersza · (d) Kalkulator · (e) Geometria · (f) Pomoc, dialogi, toasty · (g) dopracowanie, usunięcie starego kodu, a11y, zrzuty „po”, porównanie.

## 9. Checklista regresji

Każdy punkt sprawdzam w przeglądarce po etapie, którego dotyczy, i na końcu w całości.

**Zapis i wczytywanie**
- [ ] Stan z `bettergebra.v2` wczytuje się bez błędów (funkcje, aktywna, parametry, widok, tryb, przełączniki, jednostki osi, badanie, motyw)
- [ ] Stary zapis v1 (`bettergebra`, pole `graphs`/`parameters`) wczytuje się
- [ ] Zapis z trybem `set` (x → z) i `trig` (oś x w π) wczytuje się poprawnie
- [ ] Uszkodzony JSON w localStorage → start od zera bez wyjątku
- [ ] Historia i cyfry kalkulatora (`bettergebra.calc`) przetrwają przeładowanie
- [ ] Rysunek geometrii, jego widok, kratka/osie i ulubione narzędzia przetrwają przeładowanie
- [ ] Motyw: jasny/ciemny/systemowy, brak mignięcia przy przeładowaniu w ciemnym

**Nawigacja**
- [ ] `#`, `#wykresy`, `#geometria`, `#kalkulator`, `#kalkulator?q=…` otwierają właściwy ekran; wstecz/dalej działa
- [ ] Przełączenie Wykresy ↔ Zespolone zmienia tryb (Zespolone wymusza 1:1), aktywny tryb oznaczony
- [ ] Ustawienia wiersza zamykają się po wyjściu z Wykresów

**Wykresy**
- [ ] Wykres `x^2`, `sin(x)`; krzywe i obszary `x^2 + y^2 = 25`, `y > x^2`, `x = 2`
- [ ] Zbiory zespolone `|z − 1| <= 2`, `1 < Re z < 3`, `z^2 = -1`, `t + 2i`, `a + bi` z zakresem niewiadomych
- [ ] Enter dodaje wiersz pod ostatnim (gdy niepusty), przechodzi do następnego; ↑ ↓; Backspace w pustym usuwa; Esc kończy edycję
- [ ] Maks. 8 funkcji, komunikat przy próbie dodania 9.
- [ ] Błąd składni pod wierszem, `aria-invalid`; wzór MathML po wyjściu z pola; klik we wzór wraca do edycji z kursorem na końcu
- [ ] Kropka koloru ukrywa/pokazuje wykres
- [ ] Ustawienia wiersza: dziedzina (stałe `pi/2`, `−√2`), nawiasy, błąd „początek < koniec”, kolor z palety i własny, styl i grubość linii, Duplikuj, Usuń, „Zbadaj/Rozwiąż w kalkulatorze” otwiera kalkulator z zapytaniem
- [ ] Parametry pojawiają się z liter (poza x, a w warunkach poza y, z, i), suwak i pole są zsynchronizowane, zakres suwaka rośnie, błąd przy nieliczbie
- [ ] Przeciąganie, kółko, pinch, Shift + kółko (tylko y), Alt + kółko (tylko x)
- [ ] Klawisze na kanwie: strzałki, + − 0; globalne F (dopasuj y), B (badanie), ? (pomoc) — tylko poza polami
- [ ] Przyciski: przybliż, oddal, dopasuj y, 1:1, przywróć, PNG (plik `bettergebra-wykres.png`)
- [ ] Odczyt współrzędnych pod kursorem, przyciąganie do punktów, podpis zakresu
- [ ] Badanie: f(0), f(1), miejsca zerowe (dokładne bez ≈), przecięcia; dla zbioru „Zbiór”
- [ ] Widok: Siatka, Osie, Przyciąganie; etykiety osi Liczby / π / Stopnie dla x i y; zakres od–do z walidacją
- [ ] Zespolone: kolorowanie `z^2 + 1`, zera ciemne, bieguny jasne; „Miejsca zerowe w kalkulatorze”

**Kalkulator**
- [ ] Wyniki dokładne: `sqrt(72)`, `1/7 + 2/3`, `N(pi, 100)`, `100!`, `(1+2i)/(3-i)` — bez animacji i zaokrągleń
- [ ] Pochodne (`pochodna x^x`), całki nieoznaczone i oznaczone (`całka e^(-x^2) od -inf do inf`), granice, szeregi, sumy
- [ ] Równania, układy, nierówności, macierze (`det`, `inverse`, `eigenvalues`), teoria liczb, statystyka, LaTeX
- [ ] Cyfry 15/25/50/100 wpływają na wynik i są zapamiętane
- [ ] Podgląd MathML na żywo i błąd składni w podglądzie
- [ ] Pasek symboli wstawia/owija zaznaczenie
- [ ] ↑ ↓ w polu przywołują historię i wracają do szkicu
- [ ] „Obliczanie…”, Przerwij, przerwanie po 20 s
- [ ] Pusty stan z zakładkami (←, →, Home, End) i kafelkami; klik liczy
- [ ] Karty: Wejście, „Rozumiem jako”, karta błędu, kopiuj tekst, przycisk „więcej”, długie liczby zawijane
- [ ] Wykresy w wynikach: przesuwanie, przybliżanie, dwuklik, klawisze, legenda, punkty, PNG, „Otwórz w Wykresach/Zespolonych”
- [ ] Historia: klik ponawia, Wyczyść, maks. 60 wpisów; `ans`
- [ ] Link `#kalkulator?q=…` liczy po otwarciu

**Geometria**
- [ ] Wszystkie narzędzia (~40) tworzą obiekty; podpowiedź narzędzia; wybrane punkty podświetlone
- [ ] Narzędzia z pytaniem (długość, promień, nachylenie, kąt, obrót, skala, wielokąt foremny): dialog, walidacja, Anuluj, OK, Enter, Esc
- [ ] Przesuń: przeciąganie punktów, zależne obiekty podążają, tło przesuwa widok; płynnie
- [ ] Wyszukiwanie narzędzi, ulubione (gwiazdki), zapamiętane
- [ ] Pole definicji: `A = (1; 2)`, `Okrąg(A; 3)`, `y = 2x + 1`, błąd; „Polecenia i sposoby definiowania”
- [ ] Lista obiektów: edycja definicji po kliknięciu (Enter zatwierdza, Esc anuluje), licznik
- [ ] Inspektor: x, y (Enter, Esc), notatka „na obiekcie”, styl (kolor, grubość, linia, kształt, wypełnienie, etykieta, przywróć)
- [ ] Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Delete/Backspace, Esc (porzuca wybór, potem Przesuń)
- [ ] Przybliż, oddal, przywróć, kratka, osie, PNG, Wyczyść + toast z Ctrl+Z

**Pomoc i wspólne**
- [ ] Pomoc z przycisku i klawisza `?`; Esc i klik w tło zamykają; fokus wraca
- [ ] Toasty z akcją Cofnij
- [ ] Dymki na hover i fokus klawiaturą
- [ ] Brak błędów w konsoli; `npm run build` (tsc + vite) i `npm test` bez błędów i ostrzeżeń
- [ ] Szerokości 360, 768, 1024, 1440 + telefon poziomo; cele dotykowe ≥ 44 px; safe-area
- [ ] Jasny i ciemny motyw na każdym ekranie; kanwa, siatka, osie, kolory krzywych czytelne
- [ ] `prefers-reduced-motion`: brak ruchu ozdobnego
- [ ] axe/Lighthouse: brak błędów krytycznych, kontrast AA
- [ ] Przeciąganie wykresu i punktów w geometrii bez re-renderów Reacta (profil)
