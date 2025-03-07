import { useState, useRef } from 'react';

function VideoPlayer({ videoPath }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const videoRef = useRef(null);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    return (
        <div className="video-container">
            <video
                ref={videoRef}
                src={videoPath}
                controls
                style={{ width: '100%', height: 'auto' }}
            />
            <div className="controls">
                <button onClick={togglePlay}>
                    {isPlaying ? 'Pause' : 'Play'}
                </button>
            </div>
        </div>
    );
}

export default VideoPlayer;