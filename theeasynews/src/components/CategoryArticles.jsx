import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const CategoryArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const { name } = useParams();

  const API = process.env.REACT_APP_API_URL;

  useEffect(() => {
    fetch(`${API}/api/articles?category=${encodeURIComponent(name)}`)
      .then(res => res.json())
      .then(data => setArticles(data.articles || []));
  }, [API, name]);

  const save = async (articleId) => {
    await fetch(`${API}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, articleId })
    });
  };

  return (
    <div className="container article-list">
      <h1 className="page-title">{name} Articles</h1>
      <ul>
        {articles.map(a => (
          <li className="article-item" key={a.id}>
            <h3 className="article-title">{a.title}</h3>
            <p>{a.content}</p>
            <small className="article-author">By {a.author}</small>
            {userId && <button onClick={() => save(a.id)}>Save</button>}
            <div className="share-buttons">
              <FacebookShareButton url={`https://theeasy.news/articles/${a.id}`}>Share to Facebook</FacebookShareButton>
              <TwitterShareButton url={`https://theeasy.news/articles/${a.id}`}>Share to X</TwitterShareButton>
              <TelegramShareButton url={`https://theeasy.news/articles/${a.id}`}>Telegram</TelegramShareButton>
              <LinkedinShareButton url={`https://theeasy.news/articles/${a.id}`}>LinkedIn</LinkedinShareButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CategoryArticles;
