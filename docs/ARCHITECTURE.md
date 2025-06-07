# Project Architecture

This document outlines the system design for **The Easy News**, an AI‑assisted news platform. It describes the components required to gather news articles, generate new content using AI personas, and provide a user experience for browsing and saving stories.

## Overview

The application will consist of three main parts:

1. **Scraper Service** – collects articles from major news sources across different genres and stores the raw data.
2. **AI Author Service** – generates new articles from scraped data while maintaining consistent author profiles.
3. **Web Application** – allows readers to browse, save, and share generated articles.

A lightweight SQLite database stores user accounts, AI author prompts,
scraped headlines and generated articles. This keeps the prototype simple
and avoids the need for external infrastructure.

## Database Schema

```sql
-- users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

-- authors table
CREATE TABLE authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  persona TEXT NOT NULL,
  prompt TEXT NOT NULL
);

-- articles table
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  source TEXT,
  category TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- saved articles linking users and articles
CREATE TABLE saved_articles (
  user_id INTEGER,
  article_id INTEGER,
  PRIMARY KEY (user_id, article_id)
);
```

## Scraper Service

A background worker fetches articles from popular news outlets. It categorizes each piece by genre and stores the raw content in `source_articles`. The worker can be implemented using Node.js or Python with libraries such as `puppeteer` or `newspaper3k` for scraping. Deduplication ensures the same article is not processed multiple times.

## AI Author Service

Each AI author has a `persona_prompt` describing the author's style and interests. The service composes prompts by combining the persona text with the source article. Using an LLM API (e.g., OpenAI), it generates a new article which is stored in `generated_articles`. Persisting the persona prompt allows consistent style across subsequent generations.

## Web Application

The React front end communicates with a small Node.js or Express backend. Key features include:

- **Authentication** – Users sign up and log in to save articles.
- **Feed** – Lists generated articles, filtered by genre or author.
- **Article View** – Displays the article content with share buttons for X/Twitter, Facebook, Telegram, Instagram, LinkedIn, Snapchat, and Bluesky.
- **Saved Articles** – A settings page allows users to view and manage saved articles.

`react-share` or similar libraries can power the share buttons. Modern UI frameworks like Material-UI or Tailwind CSS can provide a sleek design.

## Deployment

The project can be deployed to platforms such as Netlify (for the front end) and a small Node host like Railway for the API and background jobs. Because SQLite is used, the database can simply reside on a persistent volume. Scheduled jobs trigger scraping and article generation regularly.

