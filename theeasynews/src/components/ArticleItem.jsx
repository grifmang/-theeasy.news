import React from 'react';
import { FacebookShareButton, FacebookIcon, TwitterShareButton, TwitterIcon } from 'react-share';

const ArticleItem = ({ article, userId, onSaved }) => {
  const shareUrl = window.location.href;

  const save = () => {
    if (!userId) return;
    fetch('http://localhost:5000/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, articleId: article.id })
    })
      .then(res => res.json())
      .then(onSaved)
      .catch(() => {});
  };

  return (
    <li className="article-item">
      <h3 className="article-title">{article.title}</h3>
      <p>{article.body}</p>
      {userId && <button onClick={save}>Save</button>}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <FacebookShareButton url={shareUrl} quote={article.title}>
          <FacebookIcon size={32} round />
        </FacebookShareButton>
        <TwitterShareButton url={shareUrl} title={article.title}>
          <TwitterIcon size={32} round />
        </TwitterShareButton>
      </div>
    </li>
  );
};

export default ArticleItem;
