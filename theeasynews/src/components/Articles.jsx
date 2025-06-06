import React, { useEffect, useState } from 'react';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const Articles = ({ userId }) => {
  const [articles, setArticles] = useState([]);

  const API = process.env.REACT_APP_API_URL;

  useEffect(() => {
    fetch(`${API}/api/articles`)
      .then(res => res.json())
      .then(data => setArticles(data.articles || []));
  }, []);

  const save = async (articleId) => {
    await fetch(`${API}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, articleId })
    });
  };

  return (
    <div>
      <h1>Articles</h1>
      <ul>
        {articles.map(a => (
          <li key={a.id}>
            <h3>{a.title}</h3>
            <p>{a.content}</p>
            <small>By {a.author}</small>
            {userId && <button onClick={() => save(a.id)}>Save</button>}
            <div>
              <FacebookShareButton url={`https://theeasy.news/articles/${a.id}`}>
                Share to Facebook
              </FacebookShareButton>
              <TwitterShareButton url={`https://theeasy.news/articles/${a.id}`}>
                Share to X
              </TwitterShareButton>
              <TelegramShareButton url={`https://theeasy.news/articles/${a.id}`}>
                Telegram
              </TelegramShareButton>
              <LinkedinShareButton url={`https://theeasy.news/articles/${a.id}`}>
                LinkedIn
              </LinkedinShareButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Articles;
