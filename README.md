# The Boys' Choice Awards: voting site

## Run it
1. `npm install`
2. Copy `.env.example` to `.env` and set `VOTE_CODE` and `ADMIN_KEY`
3. `npm start`, then open http://localhost:3000
4. Results (private): http://localhost:3000/admin.html

## Edit nominees
Everything lives in `data/nominees.js`. Photos are in `public/img/<id>.jpg`.

## Rules the server enforces
- One ballot per name and per device
- Only real nominee ids are accepted
- Results need the admin key

## Hosting note
Votes are saved in `data/votes.json`. Free hosts like Render wipe the disk on redeploy,
so use a persistent disk or move votes to a database before real voting day.
