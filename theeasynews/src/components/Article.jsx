import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const API = process.env.REACT_APP_API_URL || '';

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const Article = () => {
  const { id } = useParams();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/api/articles/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('Article not found');
        return res.json();
      })
      .then(data => {
        setArticle(data.article);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner" />
          <p>Loading article...</p>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="container">
        <div className="error-message">
          <p>{error || 'Article not found'}</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block' }}>Back to Articles</Link>
        </div>
      </div>
    );
  }

  const shareUrl = `${window.location.origin}/articles/${id}`;

  return (
    <div className="container">
      <article className="article-detail">
        <Link to="/" className="back-link">&larr; Back to Articles</Link>
        <h1 className="page-title">{article.title}</h1>
        <div className="article-meta">
          <span className="author">By {article.author}</span>
          {article.created_at && <span className="date">{formatDate(article.created_at)}</span>}
          {article.source && <span className="source">{article.source}</span>}
          {article.category && <span className="category-tag">{article.category}</span>}
        </div>
        <div className="article-content">{article.content}</div>
        <div className="share-buttons">
          <FacebookShareButton url={shareUrl}><span>Share on Facebook</span></FacebookShareButton>
          <TwitterShareButton url={shareUrl}><span>Share on X</span></TwitterShareButton>
          <TelegramShareButton url={shareUrl}><span>Telegram</span></TelegramShareButton>
          <LinkedinShareButton url={shareUrl}><span>LinkedIn</span></LinkedinShareButton>
        </div>
      </article>
    </div>
  );
};

export default Article;
