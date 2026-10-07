# GymFlow Clean v1

Versione pulita da caricare su GitHub da zero.

## Cosa contiene

- App personale lato cliente
- Sedute A / B / C
- Check-in giornaliero: peso, vita, dieta rispettata/non rispettata, note
- Salvataggio automatico
- IndexedDB locale: i dati restano disponibili offline
- PWA installabile sul telefono
- Allenamento offline con kg/reps per ogni serie
- Timer recupero basato su timestamp
- Ripresa allenamento dopo chiusura browser/app
- Sincronizzazione automatica quando torna Internet
- Storico giornaliero
- Storico allenamenti completo
- Excel `.xlsx` con fogli DIARIO, ALLENAMENTI, DETTAGLIO_SERIE
- PostgreSQL su Railway
- Fallback JSON per uso locale

## Login iniziale

Email: `elia@gymflow.local`
Password: `demo1234`

Su Railway puoi cambiare le credenziali impostando:
- `APP_EMAIL`
- `APP_PASSWORD`
- `SESSION_SECRET`

## Deploy Railway

1. Crea un repository GitHub vuoto.
2. Estrai questo ZIP e carica **il contenuto della cartella**, non la cartella esterna.
3. In Railway crea un nuovo progetto da GitHub.
4. Aggiungi PostgreSQL.
5. Nel servizio GymFlow aggiungi:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
6. Aggiungi anche:
   `SESSION_SECRET = una-stringa-lunga-casuale`
7. Facoltativo:
   `APP_EMAIL = tua-email`
   `APP_PASSWORD = tua-password`
8. Genera il dominio pubblico da Networking.

## Primo test offline

1. Apri GymFlow online ed effettua il login.
2. Compila almeno una volta la Home e apri una seduta.
3. Attiva modalità aereo.
4. Modifica peso/vita/dieta.
5. Avvia o continua un allenamento.
6. Registra serie, kg e reps.
7. Chiudi il browser.
8. Riapri GymFlow ancora offline.
9. I dati devono essere ancora presenti.
10. Riattiva Internet: l'indicatore deve tornare a `✓ SALVATO`.

## Nota Excel

Il file Excel viene generato dal server, quindi per scaricarlo serve connessione.
I dati registrati offline restano comunque sul dispositivo e vengono sincronizzati prima dell'export.
