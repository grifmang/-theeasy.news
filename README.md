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
   npm start
   ```
   The server listens on port `4000` by default. Set `DB_PATH` if you need the
   SQLite file in a specific location.

4. In another terminal, start the React development server:
   ```bash
   cd ../theeasynews
   npm start
   ```
   Set `REACT_APP_API_URL` in a `.env` file to the URL of your backend.

The frontend is served at `http://localhost:3000` and communicates with the
backend API using that `REACT_APP_API_URL` value.

The site now provides a simple login system, article listing with share buttons, and a page for viewing saved articles. New users can register from the login page. Articles can be saved after logging in and shared to social networks including Facebook, X/Twitter, Telegram and LinkedIn. User passwords are hashed with `bcryptjs` before being stored in the database.

### Site navigation

Pages include Home, automatically generated category links, Authors, About,
Saved Articles and Login/Logout. Categories are loaded from the database so new
topics show up as soon as articles are created.

### Scraping news

To fetch headlines from several major outlets into the local database run:

```bash
cd server
npm run scrape
```

This inserts the latest headlines from CNN, the Associated Press, Fox News and NPR. The
articles can later be expanded into AI-written pieces.

### Seeding author personas

Before generating articles, add some AI authors with their personas and prompts:

```bash
cd server
npm run seed-authors
```

This populates the `authors` table so the generator can pick from them.

### Generating articles

After scraping some headlines you can generate full articles using OpenAI. Set
the `OPENAI_API_KEY` environment variable and run:

```bash
cd server
npm run generate
```

Each run picks a random author persona and prompt from the `authors` table
and updates scraped articles with AI-written content.

### Automated generation

To continuously scrape and generate content every hour run:

```bash
cd server
npm run schedule
```

This job fetches new headlines and creates AI-written articles on a schedule.
It triggers an initial run right away if no articles exist.

### Running tests

Inside `theeasynews/` run:

```bash
npm test -- --watchAll=false
```

React Router is used in the frontend tests so dependencies must be installed with `npm install` first.

## Deployment

### Backend on Railway

1. Create a new Node.js service in Railway and connect this repository.
2. Set environment variables:
   - `PORT` (if different from `4000`)
   - `DB_PATH` – path to the SQLite file (e.g. `/data/data.db` on a persistent volume)
   - `OPENAI_API_KEY` for article generation
3. Railway runs `npm start` from the repository root. The root `package.json`
   installs dependencies under `server/` and launches the Express app.

### Frontend on Netlify

1. In Netlify, create a new site from this repository and configure the build directory `theeasynews`.
2. Set the build command to `npm run build` and publish directory to `build` (already defined in `netlify.toml`).
3. Add an environment variable `REACT_APP_API_URL` pointing to the Railway backend URL.
4. Deploy – Netlify will build the React app and serve the static files.
