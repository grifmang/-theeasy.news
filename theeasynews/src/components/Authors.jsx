import React, { useEffect, useState } from 'react';

const API = process.env.REACT_APP_API_URL || '';

const Authors = () => {
  const [authors, setAuthors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/authors`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load authors');
        return res.json();
      })
      .then(data => {
        setAuthors(data.authors || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner" />
          <p>Loading authors...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error-message"><p>{error}</p></div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="page-title">Our AI Authors</h1>
      {authors.length === 0 ? (
        <div className="empty-state">
          <h3>No authors yet</h3>
          <p>AI authors will appear here once configured.</p>
        </div>
      ) : (
        <div className="author-grid">
          {authors.map(a => (
            <div className="author-card" key={a.id}>
              <h3>{a.name}</h3>
              <p>{a.persona}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Authors;
