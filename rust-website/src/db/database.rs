// src/db/database.rs

use rusqlite::{Connection, Result};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Serialize)]
pub struct VideoMetadata {
    pub id: i64,
    pub filename: String,
    pub title: Option<String>,
    pub path: String,
    pub avg_intensity: Option<f64>,
    pub max_intensity: Option<f64>,
    pub duration: Option<i64>,
    pub rating: Option<i32>,
    pub tags: Vec<String>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Initialize schema
        conn.execute_batch(include_str!("schema.sql"))?;
        
        Ok(Self { 
            conn: Mutex::new(conn) 
        })
    }    
    
    //---  FETCH METHODS

    pub fn get_video_metadata(&self, video_id: i64) -> Result<VideoMetadata> {
        let conn = self.conn.lock().unwrap();
        let metadata = conn.query_row(
            "SELECT v.*, r.rating 
             FROM videos v 
             LEFT JOIN ratings r ON v.id = r.video_id 
             WHERE v.id = ?1",
            [video_id.to_string()],
            |row| {
                Ok(VideoMetadata {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    title: row.get(2)?,
                    path: row.get(3)?,
                    avg_intensity: row.get(4)?,
                    max_intensity: row.get(5)?,
                    duration: row.get(6)?,
                    rating: row.get(8)?,
                    tags: Vec::new(), // We'll populate this next
                })
            },
        )?;

        Ok(metadata)
    }

    pub fn search_videos(&self, query: &str) -> Result<Vec<VideoMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT v.* 
             FROM videos v
             LEFT JOIN video_tags vt ON v.id = vt.video_id
             LEFT JOIN tags t ON vt.tag_id = t.id
             WHERE v.filename LIKE ?1 
             OR v.title LIKE ?1
             OR t.name LIKE ?1"
        )?;

        let videos = stmt.query_map([format!("%{}%", query)], |row| {
            Ok(VideoMetadata {
                id: row.get(0)?,
                filename: row.get(1)?,
                title: row.get(2)?,
                path: row.get(3)?,
                avg_intensity: row.get(4)?,
                max_intensity: row.get(5)?,
                duration: row.get(6)?,
                rating: None,
                tags: Vec::new(),
            })
        })?;

        Ok(videos.filter_map(Result::ok).collect())
    }

    //---  UPDATE METHODS

    pub fn add_video(&self, path: &str, filename: &str) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        tx.execute(
            "INSERT OR IGNORE INTO videos (path, filename) VALUES (?1, ?2)",
            [path, filename],
        )?;
        
        let id = tx.last_insert_rowid();
        tx.commit()?;
        
        Ok(id)
    }
    
    pub fn set_rating(&self, video_id: i64, rating: i32) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        tx.execute(
            "INSERT OR REPLACE INTO ratings (video_id, rating) VALUES (?1, ?2)",
            [video_id.to_string(), rating.to_string()],
        )?;
        
        tx.commit()?;
        Ok(())
    }

    pub fn update_title(&self, video_id: i64, title: &str) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        tx.execute(
            "UPDATE videos SET title = ?1 WHERE id = ?2",
            [title, &video_id.to_string()],
        )?;
        
        tx.commit()?;
        Ok(())
    }

    pub fn update_tags(&self, video_id: i64, tags: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        // Remove existing tags for this video
        tx.execute(
            "DELETE FROM video_tags WHERE video_id = ?1",
            [&video_id.to_string()],
        )?;
        
        // Add new tags
        for tag in tags {
            // Insert or get tag id
            tx.execute(
                "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
                [tag],
            )?;
            
            let tag_id: i64 = tx.query_row(
                "SELECT id FROM tags WHERE name = ?1",
                [tag],
                |row| row.get(0),
            )?;
            
            // Link tag to video
            tx.execute(
                "INSERT INTO video_tags (video_id, tag_id) VALUES (?1, ?2)",
                [&video_id.to_string(), &tag_id.to_string()],
            )?;
        }
        
        tx.commit()?;
        Ok(())
    }
}

unsafe impl Send for Database {}
unsafe impl Sync for Database {}