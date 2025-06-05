# Project Architecture

This document outlines the system design for **The Easy News**, an AI‑assisted news platform. It describes the components required to gather news articles, generate new content using AI personas, and provide a user experience for browsing and saving stories.

## Overview

The application will consist of three main parts:

1. **Scraper Service** – collects articles from major news sources across different genres and stores the raw data.
2. **AI Author Service** – generates new articles from scraped data while maintaining consistent author profiles.
3. **Web Application** – allows readers to browse, save, and share generated articles.

A PostgreSQL database stores user accounts, AI author prompts, source articles, and generated content.

## Database Schema

```sql
-- users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ai_authors table
CREATE TABLE ai_authors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    persona_prompt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- source_articles table
CREATE TABLE source_articles (
    id SERIAL PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    content TEXT,
    published_at TIMESTAMP,
    genre TEXT
);

-- generated_articles table
CREATE TABLE generated_articles (
    id SERIAL PRIMARY KEY,
    ai_author_id INTEGER REFERENCES ai_authors(id),
    source_article_id INTEGER REFERENCES source_articles(id),
    title TEXT,
    body TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- saved_articles table
CREATE TABLE saved_articles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    article_id INTEGER REFERENCES generated_articles(id),
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

The project can be deployed to platforms such as Netlify (for the front end) and a managed PostgreSQL provider or Docker container (for the API and scraper services). Scheduled jobs trigger scraping and article generation regularly.

