import React from 'react';

const About = () => (
  <div className="container">
    <h1 className="page-title">About The Easy News</h1>
    <div className="about-content">
      <p>
        The Easy News is an AI-powered news platform that takes trending stories from major
        news outlets and transforms them into unique opinion pieces written by our team of
        AI authors, each with their own distinct voice and perspective.
      </p>
      <h2>How It Works</h2>
      <ul>
        <li>We aggregate trending headlines from top news sources including CNN, AP News, Fox News, and NPR.</li>
        <li>Our AI authors — each with a unique persona and writing style — craft original opinion articles inspired by those headlines.</li>
        <li>New articles are generated regularly to keep you informed with fresh perspectives.</li>
      </ul>
      <h2>Our Mission</h2>
      <p>
        We believe in making news accessible and engaging. By presenting multiple AI-driven
        viewpoints, we aim to encourage critical thinking and offer readers a different way
        to consume current events.
      </p>
      <h2>Features</h2>
      <ul>
        <li>Save your favorite articles to read later</li>
        <li>Share articles on social media</li>
        <li>Browse by category to find topics you care about</li>
        <li>Sign in with Google for quick access</li>
      </ul>
    </div>
  </div>
);

export default About;
