import React, { useEffect, useState } from 'react';
import ArticleItem from './ArticleItem';
const ArticleList = ({ userId }) => {
  const [articles, setArticles] = useState([]);

  useEffect(() => {
    fetch('http://localhost:5000/api/articles')
      .then(res => res.json())
      .then(setArticles)
      .catch(() => setArticles([]));
  }, []);

  return (
    <div>
      <h2>Latest Articles</h2>
      <ul>
        {articles.map(a => (
          <ArticleItem key={a.id} article={a} userId={userId} />
        ))}
      </ul>
    </div>
  );
};

export default ArticleList;
