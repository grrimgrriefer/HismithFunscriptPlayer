-- SQL schema for the video metadata database
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    avg_intensity INTEGER,
    max_intensity INTEGER,
    duration INTEGER,  -- in seconds
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    has_funscript BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create a table for storing all possible tags
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- Create a junction table for many-to-many relationship between videos and tags
CREATE TABLE IF NOT EXISTS video_tags (
    video_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (video_id, tag_id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);
