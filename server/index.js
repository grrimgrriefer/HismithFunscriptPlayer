import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const VIDEO_DIR = process.env.VIDEO_DIR;
const PORT = process.env.PORT;

const getAllVideos = async (dirPath) => {
    const videos = [];
    const fullPath = path.join(VIDEO_DIR, dirPath);

    try {
        const files = await fs.promises.readdir(fullPath);
        for (const file of files) {
            if (file.endsWith('.mp4') || file.endsWith('.mkv') || file.endsWith('.avi')) {
                const stats = await fs.promises.stat(path.join(fullPath, file));
                videos.push({
                    name: file,
                    size: stats.size,
                    path: path.join(dirPath, file)
                });
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error);
        throw error;
    }

    return videos;
};

app.use(cors());

// Route to get list of videos
app.get('/api/videos', async (req, res) => {
    try {
        const videos = await getAllVideos('');
        console.log('Found videos:', videos);
        res.json(videos);
    } catch (error) {
        console.error('Error reading directory:', error);
        res.status(500).json({ error: 'Failed to read videos directory' });
    }
});

// Route to stream video files
app.get('/api/videos/:filename(*)', async (req, res) => {
    const videoPath = path.join(VIDEO_DIR, req.params.filename);

    try {
        const stats = await fs.promises.stat(videoPath);
        const range = req.headers.range;

        if (!range) {
            return res.status(400).json({ error: 'Range header required' });
        }

        const positions = range.replace(/bytes=/, '').split('-');
        const start = parseInt(positions[0], 10);
        const total = stats.size;
        const end = positions[1] ? parseInt(positions[1], 10) : total - 1;
        const chunksize = (end - start) + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4'
        });

        const readStream = fs.createReadStream(videoPath, { start, end });
        readStream.pipe(res);
    } catch (error) {
        console.error('Error streaming video:', error);
        res.status(500).json({ error: 'Failed to stream video' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving videos from: ${VIDEO_DIR}`);
});