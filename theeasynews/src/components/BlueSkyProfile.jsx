import React from "react";

const BlueskyProfile = () => {
  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <img src="/bs_logo.png" alt="Bluesky Logo" style={styles.image} />
        <h1>Follow The Easy News on Bluesky</h1>
        <a
          href="https://bsky.app/profile/theeasy.news"
          style={styles.button}
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit My Profile
        </a>
      </div>
    </div>
  );
};

const styles = {
  body: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    fontFamily: "Arial, sans-serif",
    backgroundColor: "#f4f4f9",
    color: "#333",
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
  },
  container: {
    textAlign: "center",
    padding: "20px",
  },
  image: {
    maxWidth: "70%",
    marginBottom: "20px",
  },
  button: {
    display: "inline-block",
    marginTop: "20px",
    padding: "12px 24px",
    fontSize: "18px",
    color: "#fff",
    backgroundColor: "#007acc",
    textDecoration: "none",
    borderRadius: "8px",
    transition: "background-color 0.3s ease",
  },
};

export default BlueskyProfile;
