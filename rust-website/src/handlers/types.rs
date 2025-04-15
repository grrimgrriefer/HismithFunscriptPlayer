// src/handlers/types.rs

use serde::Serialize;
use crate::buttplug::funscript_utils::FunscriptData;

/// Response structure for funscript requests containing both original and 
/// generated intensity data
#[derive(Serialize, Debug)]
pub struct FunscriptResponse {
    /// The original funscript data, if found
    pub original: Option<FunscriptData>,
    /// Generated intensity data, if original was found and processing succeeded  
    pub intensity: Option<FunscriptData>,
}