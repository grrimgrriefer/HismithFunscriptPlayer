// src/funscript/structs.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    #[serde(rename = "at")]
    pub at: u64,
    #[serde(rename = "pos")]
    pub pos: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Default)]
pub struct FunscriptStats {
    #[serde(alias = "peak_intensity")]
    pub peak: f64,
    #[serde(alias = "average_intensity")]
    pub avg: f64,
    pub volatility: f64,
    #[serde(default)]
    pub duration: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunscriptData {
    pub actions: Vec<Action>,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub inverted: bool,
    #[serde(default = "default_range")]
    pub range: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

fn default_version() -> String {
    "1.0".into()
}

fn default_range() -> u32 {
    100
}

impl Default for FunscriptData {
    fn default() -> Self {
        Self {
            actions: Vec::new(),
            version: default_version(),
            inverted: false,
            range: default_range(),
            metadata: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BpmIntensityPoint {
    pub bpm: f64,
    pub intensity: f64,
}
