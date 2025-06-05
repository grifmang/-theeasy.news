# The Easy News


This repository contains the early code for a React front end and a small Node.js API. The long‑term goal is to build an AI‑assisted news site that automatically scrapes popular publications, generates articles in unique author voices, and allows readers to save and share their favorites.  Users can log in, browse articles, save them for later, and share to social networks.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for an overview of the proposed system design, including database tables and key services.

## Getting Started

Install dependencies for the front end and start it on port 3000:

```bash
The site now provides a simple login system, article listing with share buttons, and a page for viewing saved articles. New users can register from the login page. Articles can be saved after logging in and shared to social networks including Facebook, X/Twitter, Telegram and LinkedIn.

### Running tests

Inside `theeasynews/` run:

```bash
npm test -- --watchAll=false
```

React Router is used in the frontend tests so dependencies must be installed with `npm install` first.
npm install
npm start
```
The front end uses `react-router-dom` for navigation and `react-share` for share buttons. These packages are installed with `npm install`.

The API server lives in the `server` folder. Install its dependencies and start it on port 5000:

```bash
cd server
npm install
npm start
```

The React app expects the API at `http://localhost:5000` when running locally.
After logging in, navigate to `/saved` to see articles you've saved from the home page.

## Scraper Service

A simple script in `scraper/` fetches the latest headlines from NewsAPI and stores them in the SQLite database used by the API. Set the `NEWS_API_KEY` environment variable before running:

```bash
cd scraper
npm install
NEWS_API_KEY=your_key npm start
```

Articles will appear in the `source_articles` table and can later be used by the AI author service.

