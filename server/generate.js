const OpenAI = require('openai');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || 'data.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateArticles() {
  const articles = db.prepare('SELECT * FROM articles WHERE author = "RSS"').all();
  const authors = db.prepare('SELECT * FROM authors').all();
  if (authors.length === 0) {
    console.error('No authors defined');
    return;
  }

  const pickAuthor = (category) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('sport')) return authors.find(a => a.name.includes('Sports')) || authors[0];
    if (cat.includes('politic')) return authors.find(a => a.name.includes('Politics')) || authors[0];
    if (cat.includes('tech') || cat.includes('sci')) return authors.find(a => a.name.includes('AI')) || authors[0];
    return authors[Math.floor(Math.random() * authors.length)];
  };

  for (const article of articles) {
    const author = pickAuthor(article.category);
    const systemPrompt = `${author.persona}\n${author.prompt}`;
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Write a full news article summarizing: "${article.title}"`,
      },
    ];
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
      });
      const text = resp.choices[0].message.content.trim();
      db.prepare('UPDATE articles SET content=?, author=? WHERE id=?').run(text, author.name, article.id);
      console.log('Generated article', article.id);
    } catch (err) {
      console.error('Failed to generate article', article.id, err.message);
    }
  }
}

module.exports = { generateArticles };

if (require.main === module) {
  generateArticles();
}
