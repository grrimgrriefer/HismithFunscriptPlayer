// src/db/database.rs

use rusqlite::{Connection, Result};
use std::{collections::HashSet, fs};
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
        let mut metadata = conn.query_row(
            "SELECT v.id, v.filename, v.title, v.path, v.avg_intensity, v.max_intensity, v.duration, r.rating 
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
                    rating: row.get(7)?,
                    tags: Vec::new(), // We'll populate this next
                })
            },
        )?;

        // Populate tags
        let mut tags_stmt = conn.prepare("SELECT t.name FROM tags t JOIN video_tags vt ON t.id = vt.tag_id WHERE vt.video_id = ?1")?;
        let tags = tags_stmt.query_map([video_id], |row| row.get(0))?.filter_map(Result::ok).collect();
        metadata.tags = tags;

        Ok(metadata)
    }

    pub fn search_videos(&self, query: &str) -> Result<Vec<VideoMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT v.id
             FROM videos v
             LEFT JOIN video_tags vt ON v.id = vt.video_id
             LEFT JOIN tags t ON vt.tag_id = t.id
             WHERE v.filename LIKE ?1 
             OR v.title LIKE ?1
             OR t.name LIKE ?1"
        )?;

        let video_ids = stmt.query_map([format!("%{}%", query)], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        video_ids.into_iter()
            .map(|id| self.get_video_metadata(id))
            .collect()
    }

    pub fn get_or_create_video(&self, path: &str, filename: &str) -> Result<VideoMetadata> {
        // This logic is split into two parts to avoid a deadlock.
        // Part 1: Get or create the video ID. The lock is held only for this scope.
        let video_id = {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;

            // Try to find the video first
            let existing_id: Result<i64, _> =
                tx.query_row("SELECT id FROM videos WHERE path = ?1", [path], |row| {
                    row.get(0)
                });

            let id = match existing_id {
                Ok(id) => id,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    // Video not found, so insert it
                    tx.execute("INSERT INTO videos (path, filename) VALUES (?1, ?2)", [path, filename])?;
                    tx.last_insert_rowid()
                }
                Err(e) => return Err(e),
            };
            tx.commit()?;
            id
        };

        // Part 2: With the lock released, get the full metadata for the ID.
        self.get_video_metadata(video_id)
    }

    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        // Load predefined tags from an external file.
        let predefined_tags = match fs::read_to_string("predefined_tags.txt") {
            Ok(content) => content
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<HashSet<_>>(),
            Err(e) => {
                log::warn!("Could not read predefined_tags.txt: {}. No predefined tags will be loaded.", e);
                HashSet::new()
            }
        };

        let conn = self.conn.lock().unwrap();
        
        // 1. Get all unique tags from the database
        let mut db_stmt = conn.prepare("SELECT DISTINCT name FROM tags")?;
        let db_tags_iter = db_stmt.query_map([], |row| row.get::<_, String>(0))?;
        
        // 2. Use a HashSet to combine predefined and database tags, ensuring uniqueness
        let mut combined_tags = predefined_tags.clone();

        for tag_result in db_tags_iter {
            let tag = tag_result?;
            // Log a warning if a tag from the DB is not in our static list
            if !predefined_tags.contains(&tag) {
                log::warn!("Tag '{}' exists in the database but not in the predefined list.", tag);
            }
            combined_tags.insert(tag);
        }
        
        // 3. Convert back to a Vec and sort it case-insensitively for consistent ordering in the UI
        let mut sorted_tags: Vec<String> = combined_tags.into_iter().collect();
        sorted_tags.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        
        Ok(sorted_tags)
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