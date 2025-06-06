const { Configuration, OpenAIApi } = require('openai');
const Database = require('better-sqlite3');

const db = new Database('data.db');
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

async function generateArticles() {
  const articles = db.prepare('SELECT * FROM articles WHERE author = "RSS"').all();
  const authors = db.prepare('SELECT * FROM authors').all();
  if (authors.length === 0) {
    console.error('No authors defined');
    return;
  }
  for (const article of articles) {
    const author = authors[Math.floor(Math.random() * authors.length)];
    const systemPrompt = `${author.persona}\n${author.prompt}`;
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Write a full news article based on the headline: "${article.title}"`,
      },
    ];
    try {
      const resp = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages,
      });
      const text = resp.data.choices[0].message.content.trim();
      db.prepare('UPDATE articles SET content=?, author=? WHERE id=?').run(text, author.name, article.id);
      console.log('Generated article', article.id);
    } catch (err) {
      console.error('Failed to generate article', article.id, err.message);
    }
  }
}

generateArticles();
