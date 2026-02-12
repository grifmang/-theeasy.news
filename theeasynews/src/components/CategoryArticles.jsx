import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const API = process.env.REACT_APP_API_URL || '';

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const truncate = (text, maxLen = 200) => {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen).trimEnd() + '...';
};

const CategoryArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());
  const { name } = useParams();

  const fetchArticles = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/api/articles?category=${encodeURIComponent(name)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load articles');
        return res.json();
      })
      .then(data => {
        setArticles(data.articles || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [name]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const save = async (articleId) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ userId, articleId })
      });
      setSavedIds(prev => new Set(prev).add(articleId));
    } catch {
      // save failed
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner" />
          <p>Loading articles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error-message">
          <p>{error}</p>
          <button onClick={fetchArticles}>Try Again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container article-list">
      <h1 className="page-title">{name} Articles</h1>
      {articles.length === 0 ? (
        <div className="empty-state">
          <h3>No articles in this category</h3>
          <p>Check back soon for new content.</p>
        </div>
      ) : (
        <ul>
          {articles.map(a => {
            const shareUrl = `${window.location.origin}/articles/${a.id}`;
            return (
              <li className="article-card" key={a.id}>
                <div className="article-meta">
                  <span className="author">By {a.author}</span>
                  {a.created_at && <span className="date">{formatDate(a.created_at)}</span>}
                  {a.source && <span className="source">{a.source}</span>}
                </div>
                <h3 className="article-title">
                  <Link to={`/articles/${a.id}`}>{a.title}</Link>
                </h3>
                <p className="article-excerpt">{truncate(a.content)}</p>
                <div className="article-actions">
                  {userId && (
                    <button
                      className={`btn-save${savedIds.has(a.id) ? ' saved' : ''}`}
                      onClick={() => save(a.id)}
                    >
                      {savedIds.has(a.id) ? 'Saved' : 'Save'}
                    </button>
                  )}
                  <div className="share-buttons">
                    <FacebookShareButton url={shareUrl}><span>Facebook</span></FacebookShareButton>
                    <TwitterShareButton url={shareUrl}><span>X</span></TwitterShareButton>
                    <TelegramShareButton url={shareUrl}><span>Telegram</span></TelegramShareButton>
                    <LinkedinShareButton url={shareUrl}><span>LinkedIn</span></LinkedinShareButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CategoryArticles;
