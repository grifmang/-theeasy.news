# The Easy News

This repository contains a small prototype for **The Easy News**, a web application that generates AI-written news articles.

## Structure

- `theeasynews/` – React frontend created with Create React App.
- `server/` – Node.js/Express backend with a SQLite database.

## Development

1. Install dependencies for the frontend:
   ```bash
   cd theeasynews
   npm install
   ```

2. Install backend dependencies:
   ```bash
   cd ../server
   npm install
   ```

3. Start the backend server:
   ```bash
   node index.js
   ```
   The server listens on port `4000` by default.

4. In another terminal, start the React development server:
   ```bash
   cd ../theeasynews
   npm start
   ```

The frontend is served at `http://localhost:3000` and communicates with the backend API at `http://localhost:4000`.

This prototype currently exposes basic endpoints for user registration, login, article creation, and saving articles. It uses a local SQLite database stored in `server/data.db`.

### Scraping news

To fetch headlines from the New York Times RSS feed into the local database run:

```bash
cd server
npm run scrape
```

This inserts the latest headlines as articles that can later be expanded into AI-written pieces.
