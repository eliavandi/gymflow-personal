# DEPLOY RAPIDO

Repository consigliato: `gymflow-personal`

Railway:
1. New Project -> Deploy from GitHub repo.
2. Seleziona `gymflow-personal`.
3. Add -> Database -> PostgreSQL.
4. Servizio GymFlow -> Variables:
   - DATABASE_URL = ${{Postgres.DATABASE_URL}}
   - SESSION_SECRET = scegli una stringa lunga
   - APP_EMAIL = opzionale
   - APP_PASSWORD = opzionale
5. Settings -> Networking -> Generate Domain.
6. Apri `/api/health`: deve mostrare `"storage":"postgres"`.
