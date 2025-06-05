import React, { useEffect, useState } from 'react';

const SavedArticles = ({ userId }) => {
  const [articles, setArticles] = useState([]);
  useEffect(() => {
    fetch(`http://localhost:4000/api/user/${userId}/saved`)
      .then(res => res.json())
      .then(data => setArticles(data.articles || []));
  }, [userId]);

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
