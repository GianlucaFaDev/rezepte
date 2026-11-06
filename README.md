# Kochbuch

Selbst gehostete Rezeptsammlung im Rezeptkarten-Stil: Fotos, Tags (Zeit, Preis, Aufwand, Küche + freie Tags), Filter, Suche, Zufallsrezept, Portionsrechner.

**Technik:** Node.js + Express, SQLite (eine Datei), Fotos im Dateisystem, Frontend ohne Build-Schritt.
Alle Daten liegen in `data/` (`rezepte.db` + `uploads/`).

## Auf dem Server starten (Docker, empfohlen)

```bash
# Projektordner auf den Server kopieren, z. B.:
rsync -av --exclude node_modules --exclude data ./ user@server:~/kochbuch/

# auf dem Server:
cd ~/kochbuch
mkdir -p data && sudo chown 1000:1000 data   # Container läuft als UID 1000
docker compose up -d --build
```
Dann im Browser: `http://<server-ip>:3000`

Update nach Code-Änderungen: `docker compose up -d --build`

## Ohne Docker (systemd)

```bash
npm ci --omit=dev
DATA_DIR=/var/lib/kochbuch PORT=3000 node server.js
```

Beispiel `/etc/systemd/system/kochbuch.service`:
```ini
[Unit]
Description=Kochbuch
After=network.target

[Service]
WorkingDirectory=/opt/kochbuch
ExecStart=/usr/bin/node server.js
Environment=PORT=3000 DATA_DIR=/var/lib/kochbuch
# Environment=ALLOW_REGISTRATION=false
Restart=always
User=kochbuch

[Install]
WantedBy=multi-user.target
```

## Einstellungen (Umgebungsvariablen)

| Variable       | Standard  | Bedeutung                                      |
|----------------|-----------|------------------------------------------------|
| `PORT`         | `3000`    | Port                                           |
| `DATA_DIR`     | `./data`  | Ordner für Datenbank und Fotos                 |
| `ALLOW_REGISTRATION` | `true` | `false`: keine neuen Konten mehr anlegbar  |
| `USER_QUOTA_MB` | `500`    | Speicherlimit für Fotos pro Benutzer in MB (`0` = unbegrenzt) |
| `TRUST_PROXY`  | –         | Hinter einem Reverse-Proxy setzen, z. B. `1` (siehe unten) |

## Benutzer

Beim ersten Aufruf erscheint die Login-Seite, dort über „Registrieren“ ein Konto anlegen.
Jeder Benutzer sieht nur seine eigenen Rezepte und Fotos. Rezepte aus der Zeit vor dem Login
werden automatisch dem ersten registrierten Benutzer zugeordnet.

**Freischaltung:** Das erste Konto wird Admin. Alle weiteren Registrierungen müssen vom Admin
freigeschaltet werden (Benutzermenü → „Benutzer“), vorher ist keine Anmeldung möglich. Dort lassen
sich Anfragen auch ablehnen und Konten löschen. Höchstens 20 Anfragen können gleichzeitig offen sein.
Wer gar keine neuen Konten möchte: `ALLOW_REGISTRATION=false` setzen.

**Gruppen:** Unter Benutzermenü → „Gruppen“ kann jeder eine Gruppe anlegen und andere per Benutzername
einladen. Erst wenn die Einladung angenommen ist, sehen sich die Mitglieder gegenseitig ihre Rezepte
(nur lesen; „In mein Kochbuch kopieren“ legt eine eigene Kopie an). In der Übersicht schaltet man
zwischen „Meine Rezepte“ und den Gruppen um. Hat man ein Rezept kopiert, zeigt die Gruppe nur noch die
eigene Kopie statt des Originals an (keine Doppelten). Gruppenrezepte können auch im Kalender eingeplant
werden; Kalender und Kategorien selbst bleiben privat.
## Von außen erreichbar machen

Hinter einem Reverse-Proxy (Caddy, nginx, Traefik) **`TRUST_PROXY` setzen**, sonst sieht die App
für alle Besucher nur die IP des Proxys: Die Login-Sperre (10 Fehlversuche / 15 Min.) würde dann alle
gleichzeitig aussperren, und das Session-Cookie bekäme kein `Secure`-Flag.

| Aufbau | Wert |
|---|---|
| Ein Proxy davor (üblich) | `TRUST_PROXY=1` |
| Proxy auf demselben Rechner, App ohne Docker | `TRUST_PROXY=loopback` |
| Proxy als anderer Docker-Container | `TRUST_PROXY=uniquelocal` |

Ohne Proxy (App direkt erreichbar) **nicht** setzen, sonst kann jeder seine IP per Header fälschen.

Wenn die App übers Internet erreichbar sein soll: **`ALLOW_REGISTRATION=false` setzen** (nachdem die eigenen Konten angelegt sind) und einen Reverse-Proxy mit HTTPS davorschalten, z. B. Caddy:
```
rezepte.deine-domain.de {
    reverse_proxy localhost:3000
}
```
Bei nginx `client_max_body_size 50m;` setzen, damit Foto-Uploads durchgehen.

## Backup

Den Ordner `data/` sichern, z. B. per Cronjob:
```bash
sqlite3 data/rezepte.db ".backup data/backup.db" && tar czf kochbuch-$(date +%F).tgz data/
```

## Bedienung

- **Zutaten:** eine pro Zeile, Menge zuerst (`200 g Mehl`, `1½ TL Salz`). So funktioniert der Portionsrechner. Zeilen mit `:` am Ende sind Zwischenüberschriften.
- **Zubereitung:** Schritte durch Leerzeilen trennen. Zutaten werden im Text automatisch fett, manuell geht es mit `**so**`.
- **Fotos:** Das erste Foto ist das Titelbild, weitere Fotos werden der Reihe nach den Schritten zugeordnet. Große Handyfotos werden vor dem Hochladen automatisch verkleinert.
- **Blättern:** In der Detailansicht mit den Pfeilen, den Pfeiltasten ← → oder per Wischen auf dem Handy.
- **Zufall:** 🎲 oben wählt aus allen Rezepten, „Zufall aus Auswahl“ nur aus den aktuell gefilterten.
