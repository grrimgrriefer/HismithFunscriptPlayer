import { useState, useEffect } from 'react';
import VideoPlayer from './components/VideoPlayer';
import './App.css';

function App() {
  const SERVER_ADDRESS = import.meta.env.VITE_SERVER_ADDRESS;
  const SERVER_PORT = import.meta.env.VITE_SERVER_PORT;

  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = async () => {
    try {
      console.log(SERVER_ADDRESS);

      const response = await fetch(`http://${SERVER_ADDRESS}:${SERVER_PORT}/api/videos`);
      const data = await response.json();
      setVideos(data);
      if (data.length > 0) {
        setSelectedVideo(data[0]);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
    }
  };

  return (
    <div className="app">
      <h1>Video Player</h1>
      <div className="video-player">
        <div className="video-container">
          {selectedVideo && <VideoPlayer videoPath={`http://${SERVER_ADDRESS}:${SERVER_PORT}/api/videos/${selectedVideo.name}`} />}
        </div>
        <div id="buttons">
          <button id="buttplug-websocket-button">
            Press me to hopefully make things vibrate via WebSockets.
          </button> (Win10, Requires <a href="https://intiface.com/desktop">Intiface Desktop App</a> running on 127.0.0.1)<br />
          <button id="buttplug-local-button">
            Press me to hopefully make things vibrate via WebBluetooth
          </button> (Chrome on Windows 10/macOS/Linux/Android/Chrome OS only)<br />
          <br />
          <br />
        </div>
        <div id="output">
          <b>Devices Connected:</b>
          <ul id="devices">
          </ul>
        </div>
        <script src="script.mjs" type="module" defer></script>
        <div className="video-list">
          <ul>
            {videos.map((video) => (
              <li
                key={video.name}
                className={selectedVideo?.name === video.name ? 'selected' : ''}
                onClick={() => setSelectedVideo(video)}
              >
                {video.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;