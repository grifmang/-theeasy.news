const OpenAI = require('openai');
const Database = require('better-sqlite3');
const path = require('path');

function legacyConfig(env = process.env) {
  if (env.LEGACY_GENERATION_ENABLED !== 'true') {
    throw new Error('Legacy title-only generation is disabled; set LEGACY_GENERATION_ENABLED=true only for an explicitly approved recovery run');
  }
  if (env.GENERATION_ENABLED !== 'true') {
    throw new Error('GENERATION_ENABLED=true is also required for paid generation');
  }
  if (typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  if (typeof env.DB_PATH !== 'string' || !path.isAbsolute(env.DB_PATH) || env.DB_PATH.includes('\0')) {
    throw new Error('DB_PATH must be an absolute path');
  }
  return { dbPath: env.DB_PATH, apiKey: env.OPENAI_API_KEY };
}

async function generateArticles() {
  const { dbPath, apiKey } = legacyConfig();
  const db = new Database(dbPath);
  const openai = new OpenAI({ apiKey });
  try {
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
  } finally {
    db.close();
  }
}

module.exports = { generateArticles, legacyConfig };

if (require.main === module) {
  generateArticles().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
