// src/db/database.rs

use rusqlite::{params_from_iter, Connection, Result, params, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::sync::Mutex;
use std::path::PathBuf;
use std::env;

#[derive(Serialize)]
pub struct OrphanVideoInfo {
    pub id: i64,
    pub path: String,
    pub file_size: i64,
}

#[derive(Serialize)]
pub struct VideoMetadata {
    pub id: i64,
    pub filename: String,
    pub path: String,
    pub file_size: i64,
    pub avg_intensity: Option<i64>,
    pub max_intensity: Option<i64>,
    pub duration: Option<i64>,
    pub rating: Option<i32>,
    pub has_funscript: bool,
    pub tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(tag = "status", content = "video")]
pub enum GetOrCreateResult {
    Created(VideoMetadata),
    FoundByPath(VideoMetadata),
    FoundByContent(VideoMetadata),
}

pub struct Database {
    conn: Mutex<Connection>,
}

pub struct VideoMetadataUpdatePayload {
    pub id: i64,
    pub rating: Option<i32>,
    pub tags: Option<Vec<String>>,
    pub avg_intensity: Option<i64>,
    pub max_intensity: Option<i64>,
    pub duration: Option<i64>,
    pub has_funscript: Option<bool>,
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
            "SELECT id, filename, path, file_size, avg_intensity, max_intensity, duration, rating, has_funscript
             FROM videos
             WHERE id = ?1",
            [video_id],
            |row| {
                Ok(VideoMetadata {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    path: row.get(2)?,
                    file_size: row.get(3)?,
                    avg_intensity: row.get(4)?,
                    max_intensity: row.get(5)?,
                    duration: row.get(6)?,
                    rating: row.get(7)?,
                    has_funscript: row.get(8)?,
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

    pub fn search_videos(
        &self,
        query: &str,
        min_duration: Option<i64>,
        max_duration: Option<i64>,
        min_avg_intensity: Option<f64>,
        max_avg_intensity: Option<f64>,
    ) -> Result<Vec<VideoMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT
                v.id, v.path, v.filename, v.file_size, v.rating, v.duration, v.avg_intensity, v.max_intensity, v.has_funscript,
                GROUP_CONCAT(t.name)
             FROM videos v
             LEFT JOIN video_tags vt ON v.id = vt.video_id
             LEFT JOIN tags t ON vt.tag_id = t.id
             WHERE (v.id IN (
                SELECT DISTINCT v_inner.id
                FROM videos v_inner
                LEFT JOIN video_tags vt_inner ON v_inner.id = vt_inner.video_id
                LEFT JOIN tags t_inner ON vt_inner.tag_id = t_inner.id
                WHERE v_inner.filename LIKE ?1 OR t_inner.name LIKE ?1
             ))",
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(format!("%{}%", query))];

        if let Some(val) = min_duration {
            sql.push_str(" AND v.duration >= ?");
            params.push(Box::new(val));
        }
        if let Some(val) = max_duration {
            sql.push_str(" AND v.duration <= ?");
            params.push(Box::new(val));
        }
        if let Some(val) = min_avg_intensity {
            sql.push_str(" AND v.avg_intensity >= ?");
            params.push(Box::new(val));
        }
        if let Some(val) = max_avg_intensity {
            sql.push_str(" AND v.avg_intensity <= ?");
            params.push(Box::new(val));
        }

        sql.push_str(" GROUP BY v.id");

        let mut stmt = conn.prepare(&sql)?;
        let videos_iter = stmt.query_map(params_from_iter(params), |row| {
            let tags_str: Option<String> = row.get(9)?;
            let tags = tags_str
                .map(|s| s.split(',').map(String::from).collect())
                .unwrap_or_else(Vec::new);

            Ok(VideoMetadata {
                id: row.get(0)?,
                path: row.get(1)?,
                filename: row.get(2)?,
                file_size: row.get(3)?,
                rating: row.get(4)?,
                duration: row.get(5)?,
                avg_intensity: row.get(6)?,
                max_intensity: row.get(7)?,
                has_funscript: row.get(8)?,
                tags,
            })
        })?;

        videos_iter.collect()
    }

    pub fn get_or_create_video(
        &self,
        path: &str,
        filename: &str,
    ) -> Result<GetOrCreateResult, rusqlite::Error> {
        // Construct the full path to the video file.
        let base_path = match env::var("VIDEO_SHARE_PATH") {
            Ok(p) => p,
            Err(e) => {
                log::error!("VIDEO_SHARE_PATH not set: {}", e);
                return Err(rusqlite::Error::InvalidPath(
                    "Server configuration error: VIDEO_SHARE_PATH not set".into(),
                ));
            }
        };
        let full_path = PathBuf::from(base_path).join(path);

        enum VideoFindStatus { Created, FoundByPath, FoundByContent }

        let (video_id, status) = {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;

            let id_and_status_result = if let Some(id) = tx
                .query_row("SELECT id FROM videos WHERE path = ?1", [path], |row| {
                    row.get(0)
                })
                .optional()?
            {
                Ok((id, VideoFindStatus::FoundByPath))
            } else {
                // Video not found by path, so get file size and try to insert.
                let file_size = match fs::metadata(&full_path) {
                    Ok(meta) => meta.len() as i64,
                    Err(e) => {
                        log::error!("Failed to get metadata for {:?}: {}", full_path, e);
                        return Err(rusqlite::Error::InvalidPath(full_path.to_path_buf()));
                    }
                };

                match tx.execute(
                    "INSERT INTO videos (path, filename, file_size) VALUES (?1, ?2, ?3)",
                    params![path, filename, &file_size],
                ) {
                    Ok(_) => Ok((tx.last_insert_rowid(), VideoFindStatus::Created)),
                    Err(rusqlite::Error::SqliteFailure(e, _))
                        if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                    {
                        // This is a duplicate. Find the existing video by file_size.
                        tx.query_row(
                            "SELECT id FROM videos WHERE file_size = ?1",
                            params![&file_size],
                            |row| row.get(0),
                        )
                        .map(|id| (id, VideoFindStatus::FoundByContent))
                    }
                    Err(e) => Err(e),
                }
            };

            match id_and_status_result {
                Ok(res) => {
                    tx.commit()?;
                    Ok(res)
                }
                Err(e) => Err(e),
            }
        }?;

        // Part 2: With the lock released, get the full metadata for the ID.
        let metadata = self.get_video_metadata(video_id)?;

        match status {
            VideoFindStatus::Created => Ok(GetOrCreateResult::Created(metadata)),
            VideoFindStatus::FoundByPath => Ok(GetOrCreateResult::FoundByPath(metadata)),
            VideoFindStatus::FoundByContent => Ok(GetOrCreateResult::FoundByContent(metadata)),
        }
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

    pub fn get_all_video_paths(&self) -> Result<HashSet<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT path FROM videos")?;
        let paths_iter = stmt.query_map([], |row| row.get(0))?;
        
        let mut paths = HashSet::new();
        for path_result in paths_iter {
            paths.insert(path_result?);
        }
        Ok(paths)
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
    
    pub fn update_video_metadata(&self, payload: &VideoMetadataUpdatePayload) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Update fields in the `videos` table
        tx.execute(
            "UPDATE videos
             SET
                rating = COALESCE(?1, rating),
                avg_intensity = COALESCE(?2, avg_intensity),
                max_intensity = COALESCE(?3, max_intensity),
                duration = COALESCE(?4, duration),
                has_funscript = COALESCE(?5, has_funscript)
             WHERE id = ?6",
            rusqlite::params![
                payload.rating,
                payload.avg_intensity,
                payload.max_intensity,
                payload.duration,
                payload.has_funscript,
                payload.id
            ],
        )?;

        // Update tags if they are provided
        if let Some(tags) = &payload.tags {
            // Remove existing tags for this video
            tx.execute("DELETE FROM video_tags WHERE video_id = ?1", [payload.id])?;

            // Add new tags
            for tag in tags {
                tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])?;
                let tag_id: i64 =
                    tx.query_row("SELECT id FROM tags WHERE name = ?1", [tag], |row| row.get(0))?;
                tx.execute(
                    "INSERT INTO video_tags (video_id, tag_id) VALUES (?1, ?2)",
                    [payload.id, tag_id],
                )?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_all_videos_for_check(&self) -> Result<Vec<OrphanVideoInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, path, file_size FROM videos WHERE file_size > 0")?;
        let videos_iter = stmt.query_map([], |row| {
            Ok(OrphanVideoInfo {
                id: row.get(0)?,
                path: row.get(1)?,
                file_size: row.get(2)?,
            })
        })?;
        videos_iter.collect()
    }

    pub fn video_exists_by_path(&self, path: &str) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id FROM videos WHERE path = ?1",
            [path],
            |row| row.get(0),
        )
        .optional()
    }

    pub fn delete_video(&self, video_id: i64) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM video_tags WHERE video_id = ?1", [video_id])?;
        tx.execute("DELETE FROM videos WHERE id = ?1", [video_id])?;
        tx.commit()
    }

    pub fn update_video_path(&self, video_id: i64, new_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let new_filename = PathBuf::from(new_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        conn.execute(
            "UPDATE videos SET path = ?1, filename = ?2 WHERE id = ?3",
            params![new_path, new_filename, video_id],
        )?;
        Ok(())
    }
}

unsafe impl Send for Database {}
unsafe impl Sync for Database {}