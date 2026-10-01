"""Zrzuty karty w kilku stanach (jasny i ciemny motyw) + sprawdzenie konsoli.

Użycie:  python3 tests/screenshots.py [port]
Zrzuty lądują w /tmp/shots/card-<stan>-<motyw>.png
"""
import functools
import http.server
import os
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "/tmp/shots"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 0

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
os.makedirs(OUT, exist_ok=True)

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for theme in ("light", "dark"):
        page = browser.new_page(viewport={"width": 1180, "height": 900}, device_scale_factor=1)
        page.on("console", lambda m: m.type in ("error", "warning") and errors.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(f"http://127.0.0.1:{port}/tests/preview.html?theme={theme}")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/card-all-{theme}.png", full_page=True)
        for case in page.eval_on_selector_all(".case", "els => els.map(e => e.id)"):
            page.locator(f"#{case}").screenshot(path=f"{OUT}/card-{case[5:]}-{theme}.png")

        if theme == "light":
            # klik w PM10 → hass-more-info z właściwą encją
            page.locator("#case-normal air-locker-map-card .tile").nth(1).click()
            page.locator("#case-normal air-locker-map-card .big").click()
            events = page.evaluate("window.__events")
            assert events == ["sensor.powietrze_dom_pm10", "sensor.powietrze_dom_pm2_5"], events
            href = page.locator("#case-normal air-locker-map-card .maplink").get_attribute("href")
            assert href == "https://air-locker-map.studio-colorbox.com/#lat=52.23229&lon=20.95952&z=14", href
            stub = page.evaluate("window.__stub")
            assert stub == {"entity": "sensor.powietrze_dom_pm2_5"}, stub
            text = page.locator("#case-normal air-locker-map-card .card").inner_text()
            for needle in ("6,8", "bardzo dobry", "45% normy WHO", "WAW43BAPP", "1,6 km", "odczyt 12 min temu", "1013"):
                assert needle in text, (needle, text)
            assert "570 m" in page.locator("#case-bad air-locker-map-card .card").inner_text()
            assert "wilgotność > 95%" in page.locator("#case-suspect air-locker-map-card .card").inner_text()
            assert "dobry" in page.locator("#case-device-id air-locker-map-card .card").inner_text()
            assert "brak danych" in page.locator("#case-unavailable air-locker-map-card .card").inner_text()
        page.close()
    browser.close()
httpd.shutdown()

print("Błędy konsoli:", errors or "brak")
print("Zrzuty:", sorted(f for f in os.listdir(OUT) if f.startswith("card-")))
sys.exit(1 if errors else 0)
