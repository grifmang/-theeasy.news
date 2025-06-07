import React, { useEffect, useState } from 'react';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const SavedArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const API = process.env.REACT_APP_API_URL || '';
  useEffect(() => {
    fetch(`${API}/api/user/${userId}/saved`)
      .then(res => res.json())
      .then(data => setArticles(data.articles || []));
  }, [userId, API]);

  return (
    <div className="container article-list">
      <h1 className="page-title">Saved Articles</h1>
      <ul>
        {articles.map(a => (
          <li className="article-item" key={a.id}>
            <h3 className="article-title">{a.title}</h3>
            <p>{a.content}</p>
            <small className="article-author">By {a.author}</small>
            <div className="share-buttons">
              <FacebookShareButton url={`https://theeasy.news/articles/${a.id}`}>Share</FacebookShareButton>
              <TwitterShareButton url={`https://theeasy.news/articles/${a.id}`}>X</TwitterShareButton>
              <TelegramShareButton url={`https://theeasy.news/articles/${a.id}`}>Telegram</TelegramShareButton>
              <LinkedinShareButton url={`https://theeasy.news/articles/${a.id}`}>LinkedIn</LinkedinShareButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SavedArticles;
