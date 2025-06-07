import React, { useEffect, useState } from 'react';

const SavedArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  const API = process.env.REACT_APP_API_URL;
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
          <li className="article-item" key={a.id}>{a.title}</li>
        ))}
      </ul>
    </div>
  );
};

export default SavedArticles;
