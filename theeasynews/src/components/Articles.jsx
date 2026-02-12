import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FacebookShareButton, TwitterShareButton, TelegramShareButton, LinkedinShareButton } from 'react-share';

const API = process.env.REACT_APP_API_URL || '';
const ARTICLES_PER_PAGE = 12;

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const truncate = (text, maxLen = 200) => {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen).trimEnd() + '...';
};

const Articles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [savedIds, setSavedIds] = useState(new Set());

  const fetchArticles = useCallback(() => {
    setLoading(true);
    setError(null);
    let url = `${API}/api/articles?page=${page}&limit=${ARTICLES_PER_PAGE}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load articles');
        return res.json();
      })
      .then(data => {
        setArticles(data.articles || []);
        setTotalPages(data.totalPages || 1);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [page, search]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

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
      // save failed silently
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
      <h1 className="page-title">Latest Articles</h1>
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="search"
          placeholder="Search articles..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          aria-label="Search articles"
        />
        <button type="submit" className="btn btn-primary">Search</button>
      </form>
      {articles.length === 0 ? (
        <div className="empty-state">
          <h3>No articles found</h3>
          <p>{search ? 'Try a different search term.' : 'Check back soon for new articles.'}</p>
        </div>
      ) : (
        <>
          <ul>
            {articles.map(a => {
              const shareUrl = `${window.location.origin}/articles/${a.id}`;
              return (
                <li className="article-card" key={a.id}>
                  <div className="article-meta">
                    <span className="author">By {a.author}</span>
                    {a.created_at && <span className="date">{formatDate(a.created_at)}</span>}
                    {a.source && <span className="source">{a.source}</span>}
                    {a.category && <span className="category-tag">{a.category}</span>}
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
          {totalPages > 1 && (
            <div className="pagination">
              <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}>Previous</button>
              <span className="page-info">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Articles;
