import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const API = process.env.REACT_APP_API_URL || '';

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const SavedArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${API}/api/user/${userId}/saved`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to load saved articles');
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
  }, [userId]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner" />
          <p>Loading saved articles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error-message">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container article-list">
      <h1 className="page-title">Saved Articles</h1>
      {articles.length === 0 ? (
        <div className="empty-state">
          <h3>No saved articles yet</h3>
          <p>Browse articles and click "Save" to bookmark them here.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block', textDecoration: 'none' }}>Browse Articles</Link>
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
                <p className="article-excerpt">{a.content}</p>
                <div className="share-buttons">
                  <FacebookShareButton url={shareUrl}><span>Facebook</span></FacebookShareButton>
                  <TwitterShareButton url={shareUrl}><span>X</span></TwitterShareButton>
                  <TelegramShareButton url={shareUrl}><span>Telegram</span></TelegramShareButton>
                  <LinkedinShareButton url={shareUrl}><span>LinkedIn</span></LinkedinShareButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SavedArticles;
