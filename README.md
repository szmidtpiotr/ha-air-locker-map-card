# Air Locker Map Card

Karta do panelu Home Assistanta dla integracji
[Air Locker Map](https://github.com/szmidtpiotr/ha-air-locker-map), czyli odczytów
z czujników powietrza w paczkomatach InPost. Mapa wszystkich czujników:
<https://air-locker-map.studio-colorbox.com/>.

> Zrzut ekranu dodamy wkrótce. Do tego czasu podgląd możesz otworzyć lokalnie
> w `tests/preview.html` (opis niżej).

## Co pokazuje karta

- **PM2.5** dużą cyfrą, z indeksem jakości powietrza według progów GIOŚ
  (bardzo dobry, dobry, umiarkowany, dostateczny, zły, bardzo zły), kolorem i paskiem skali.
- **Procent normy dobowej WHO**: 15 µg/m³ dla PM2.5 i 45 µg/m³ dla PM10.
- Mniejsze kafelki: **PM1**, **PM10** (z własnym indeksem GIOŚ dla PM10) i **ciśnienie** sprowadzone do poziomu morza.
- Stopkę: kod paczkomatu z czujnikiem, jego adres, odległość („1,6 km”, „570 m”)
  i czas od odczytu („odczyt 12 min temu”).
- **Ostrzeżenie**, gdy integracja oznaczy odczyt jako podejrzany, razem z powodami
  (np. zawieszony odczyt albo zalany czujnik).
- Link **„Zobacz na mapie”**, który otwiera mapę na paczkomacie źródłowym.

Kliknięcie w dowolną wartość otwiera standardowe okno szczegółów encji, z historią.
Karta korzysta z kolorów motywu, więc wygląda dobrze w jasnym i w ciemnym.
Gdy encja jest niedostępna, karta pokazuje „brak danych”.

## Instalacja

### HACS (zalecana)

1. HACS → menu ⋮ → **Niestandardowe repozytoria**.
2. Adres: `https://github.com/szmidtpiotr/ha-air-locker-map-card`, kategoria **Dashboard**.
3. Znajdź „Air Locker Map Card” i kliknij **Pobierz**.
4. Odśwież przeglądarkę (Ctrl+F5).

HACS sam dodaje zasób `/hacsfiles/ha-air-locker-map-card/air-locker-map-card.js`.

### Ręcznie

1. Skopiuj `air-locker-map-card.js` do `/config/www/`.
2. Ustawienia → Panele → menu ⋮ → **Zasoby** → dodaj `/local/air-locker-map-card.js`
   jako **moduł JavaScript**.

## Konfiguracja

Najprościej: **Dodaj kartę → Air Locker Map** i wybierz czujnik PM2.5 w edytorze.

W YAML:

```yaml
type: custom:air-locker-map-card
entity: sensor.powietrze_dom_pm2_5
```

Wszystkie opcje:

```yaml
type: custom:air-locker-map-card
entity: sensor.powietrze_dom_pm2_5   # czujnik PM2.5 z integracji Air Locker Map
title: Powietrze przy domu           # domyślnie nazwa urządzenia
show_pressure: true                  # kafelek z ciśnieniem
show_details: true                   # paczkomat, adres, odległość, czas odczytu
map_url: https://air-locker-map.studio-colorbox.com/
```

| Opcja | Domyślnie | Opis |
|---|---|---|
| `entity` | — | Czujnik PM2.5 z integracji (wymagany, chyba że podasz `device_id`). |
| `device_id` | — | Zamiast `entity`: identyfikator urządzenia Air Locker Map. |
| `title` | nazwa urządzenia | Tytuł karty. |
| `show_pressure` | `true` | Pokazuj kafelek z ciśnieniem. |
| `show_details` | `true` | Pokazuj paczkomat, adres, odległość i czas odczytu. |
| `map_url` | adres publicznej mapy | Własna instancja mapy. |
| `pm1_entity`, `pm10_entity`, `pressure_entity`, `distance_entity`, `updated_entity`, `source_entity`, `problem_entity` | wykrywane | Ręczne wskazanie encji, gdyby automat się pomylił. |

### Jak karta znajduje resztę encji

Wystarczy wskazać czujnik PM2.5. Karta odczytuje z rejestru encji jego urządzenie
i bierze pozostałe encje tego samego urządzenia z integracji `air_locker_map`.
Rozpoznaje je po kluczu tłumaczenia albo klasie urządzenia, więc działa także wtedy,
gdy zmienisz identyfikatory encji.

## Podgląd bez Home Assistanta

```bash
python3 -m http.server 8765
# http://localhost:8765/tests/preview.html  (dodaj ?theme=dark dla ciemnego motywu)
```

`python3 tests/screenshots.py` robi zrzuty wszystkich stanów do `/tmp/shots/`
(wymaga Playwrighta z Chromium).

## Licencja

MIT, zobacz [LICENSE](LICENSE).
