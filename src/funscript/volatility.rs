// src/funscript/volatility.rs

use crate::funscript::structs::Action;
use crate::funscript::curves::actions_to_intensity_curve;
use serde::{Deserialize, Serialize};

pub fn calculate_volatility(actions: &[Action]) -> f64 {
    calculate_volatility_with_sections(actions).0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionInfo {
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub peak_intensity: f64,
    pub mean_intensity: f64,
}

#[derive(Clone)]
struct Section {
    start: f64,
    end: f64,
    duration: f64,
    peak_intensity: f64,
    mean_intensity: f64,
    bucket: String,
}

fn get_bucket(intensity: f64) -> String {
    let val = intensity.clamp(0.0, 100.0);
    let mut lower = (val / 10.0).floor() as u32 * 10;
    if lower >= 100 {
        lower = 90;
    }
    format!("{}-{}", lower, lower + 10)
}

fn make_section(slice: &[(f64, f64)]) -> Option<Section> {
    let first = slice.first()?;
    let last = slice.last()?;
    let duration = last.0 - first.0;
    let peak = slice.iter().map(|p| p.1).fold(0.0, f64::max);
    let mean = slice.iter().map(|p| p.1).sum::<f64>() / slice.len() as f64;
    Some(Section {
        start: first.0,
        end: last.0,
        duration,
        peak_intensity: peak,
        mean_intensity: mean,
        bucket: get_bucket(mean),
    })
}

fn compute_sections(curve: &[(f64, f64)]) -> Vec<Section> {
    if curve.is_empty() {
        return Vec::new();
    }

    let min_duration = 1.0;
    let mut sections = Vec::new();
    let mut current_start_idx = 0;
    let mut i = 0;

    while i < curve.len() {
        let window = &curve[current_start_idx..=i];
        let c_min = window.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let c_max = window.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
        let c_mean = window.iter().map(|p| p.1).sum::<f64>() / window.len() as f64;
        let max_variation = (3.5 + c_mean * 0.10).clamp(3.5, 15.0);

        if c_max - c_min > max_variation {
            let mut split_idx = current_start_idx.max(i.saturating_sub(1));

            if curve[i].1 >= curve[current_start_idx].1 {
                let mut min_val = curve[i].1;
                for idx in (current_start_idx..=i).rev() {
                    if curve[idx].1 <= min_val {
                        min_val = curve[idx].1;
                        split_idx = idx;
                    } else {
                        break;
                    }
                }
            } else {
                let mut max_val = curve[i].1;
                for idx in (current_start_idx..=i).rev() {
                    if curve[idx].1 >= max_val {
                        max_val = curve[idx].1;
                        split_idx = idx;
                    } else {
                        break;
                    }
                }
            }

            let end_idx = if split_idx > current_start_idx {
                split_idx
            } else {
                current_start_idx.max(i.saturating_sub(1))
            };

            if let Some(sec) = make_section(&curve[current_start_idx..=end_idx]) {
                sections.push(sec);
            }

            current_start_idx = end_idx + 1;
            i = current_start_idx;
        } else if i == curve.len() - 1 {
            if let Some(sec) = make_section(&curve[current_start_idx..=i]) {
                sections.push(sec);
            }
            i += 1;
        } else {
            i += 1;
        }
    }

    let mut changed = true;
    while changed {
        changed = false;
        if sections.len() <= 1 {
            break;
        }

        let mut new_sections = vec![sections[0].clone()];
        for j in 1..sections.len() {
            let sec = &sections[j];
            let prev = new_sections.last_mut().unwrap();

            if sec.bucket == prev.bucket || sec.duration < min_duration || prev.duration < min_duration {
                let total_dur = prev.duration + sec.duration;
                let new_peak = prev.peak_intensity.max(sec.peak_intensity);
                let new_mean = if total_dur > 0.0 {
                    (prev.mean_intensity * prev.duration + sec.mean_intensity * sec.duration) / total_dur
                } else {
                    0.0
                };

                prev.end = sec.end;
                prev.duration = total_dur;
                prev.peak_intensity = new_peak;
                prev.mean_intensity = new_mean;
                prev.bucket = get_bucket(new_mean);
                changed = true;
            } else {
                new_sections.push(sec.clone());
            }
        }
        sections = new_sections;
    }

    sections
}

fn calculate_volatility_from_sections(sections: &[Section]) -> f64 {
    if sections.is_empty() {
        return 0.0;
    }

    let total_duration_sec: f64 = sections.iter().map(|s| s.duration).sum();
    let num_sections = sections.len();
    if total_duration_sec <= 0.0 || num_sections == 0 {
        return 0.0;
    }

    let avg_section_duration = total_duration_sec / num_sections as f64;
    let mut jumps = Vec::new();
    for i in 0..num_sections - 1 {
        jumps.push((sections[i + 1].mean_intensity - sections[i].mean_intensity).abs());
    }
    let avg_intensity_jump = if !jumps.is_empty() {
        jumps.iter().sum::<f64>() / jumps.len() as f64
    } else {
        0.0
    };

    let variance = sections
        .iter()
        .map(|s| (s.duration - avg_section_duration).powi(2))
        .sum::<f64>()
        / num_sections as f64;
    let std_dev_section_duration = variance.sqrt();

    let avg_duration_norm = (1.0 - (avg_section_duration - 5.0) / 25.0).clamp(0.0, 1.0);
    let avg_jump_norm = ((avg_intensity_jump - 5.0) / 35.0).clamp(0.0, 1.0);
    let std_dev_norm = (std_dev_section_duration / 15.0).clamp(0.0, 1.0);

    let raw_score = 0.50 * avg_duration_norm + 0.30 * avg_jump_norm + 0.20 * std_dev_norm;
    ((raw_score * 9.0 + 1.0).clamp(1.0, 10.0) * 10.0).round() / 10.0
}

pub fn calculate_volatility_with_sections(actions: &[Action]) -> (f64, Vec<SectionInfo>) {
    if actions.len() < 2 {
        return (0.0, Vec::new());
    }

    let curve_actions = actions_to_intensity_curve(actions, &[]);
    if curve_actions.is_empty() {
        return (0.0, Vec::new());
    }

    let curve: Vec<(f64, f64)> = curve_actions
        .iter()
        .map(|a| (a.at as f64 / 1000.0, a.pos))
        .collect();

    let sections = compute_sections(&curve);
    if sections.is_empty() {
        return (0.0, Vec::new());
    }

    let score = calculate_volatility_from_sections(&sections);

    let section_infos = sections
        .into_iter()
        .map(|s| SectionInfo {
            start: s.start,
            end: s.end,
            duration: s.duration,
            peak_intensity: s.peak_intensity,
            mean_intensity: s.mean_intensity,
        })
        .collect();

    (score, section_infos)
}
