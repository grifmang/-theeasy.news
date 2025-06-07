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
    <div>
      <h1>Saved Articles</h1>
      <ul>
        {articles.map(a => (
          <li key={a.id}>{a.title}</li>
        ))}
      </ul>
    </div>
  );
};

export default SavedArticles;
