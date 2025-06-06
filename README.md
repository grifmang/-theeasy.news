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

The site now provides a simple login system, article listing with share buttons, and a page for viewing saved articles. New users can register from the login page. Articles can be saved after logging in and shared to social networks including Facebook, X/Twitter, Telegram and LinkedIn.

### Scraping news

To fetch headlines from the New York Times RSS feed into the local database run:

```bash
cd server
npm run scrape
```

This inserts the latest headlines as articles that can later be expanded into AI-written pieces.

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

### Running tests

Inside `theeasynews/` run:

```bash
npm test -- --watchAll=false
```

React Router is used in the frontend tests so dependencies must be installed with `npm install` first.
