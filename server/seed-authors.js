const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const dbPath = process.env.DB_PATH || 'data.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const authors = [
  {
    name: 'Jane AI',
    persona: 'A tech-focused journalist who loves gadgets and AI research.',
    prompt: 'Write in a witty yet informative tone with short paragraphs.'
  },
  {
    name: 'Bob Sports',
    persona: 'An energetic sports commentator passionate about US sports.',
    prompt: 'Use exciting language and highlight standout performances.'
  },
  {
    name: 'Sally Politics',
    persona: 'A veteran political reporter providing balanced coverage.',
    prompt: 'Maintain a neutral style while explaining background context clearly.'
  }
];

const insert = db.prepare('INSERT OR IGNORE INTO authors (name, persona, prompt) VALUES (?, ?, ?)');
authors.forEach(a => insert.run(a.name, a.persona, a.prompt));
console.log('Seeded authors', authors.length);

