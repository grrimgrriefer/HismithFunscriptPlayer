#!/usr/bin/env python3
import os
import sys
import json
import subprocess

def get_video_duration(video_path):
    """Uses ffprobe to get the video duration in seconds."""
    cmd = [
        'ffprobe', '-v', 'error', 
        '-show_entries', 'format=duration', 
        '-of', 'default=noprint_wrappers=1:nokey=1', 
        video_path
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return int(float(result.stdout.strip()))
    except Exception:
        return None

def get_script_duration(script_path):
    """Parses the funscript JSON to get the last 'at' timestamp in seconds."""
    try:
        with open(script_path, 'r', encoding='utf-8', errors='ignore') as f:
            data = json.load(f)
            actions = data.get("actions", [])
            if actions:
                return int(actions[-1]["at"]) // 1000
    except Exception:
        return None
    return None

def main():
    # 1. Ensure directories are provided via command arguments
    if len(sys.argv) < 3:
        print("Usage: python3 check_deltas.py <VIDEO_DIR> <FUNSCRIPT_DIR>")
        sys.exit(1)

    video_dir = os.path.abspath(sys.argv[1])
    funscript_dir = os.path.abspath(sys.argv[2])

    results = []
    video_extensions = ('.mp4', '.mkv', '.avi', '.mov')

    print("Scanning directories... (this might take a moment)\n")

    # 2. Recursively walk through the video directory
    for root, _, files in os.walk(video_dir):
        for file in files:
            if not file.lower().endswith(video_extensions):
                continue

            video_path = os.path.join(root, file)
            
            # Calculate the relative path to maintain identical nested structure
            rel_path = os.path.relpath(video_path, video_dir)
            rel_dir, filename = os.path.split(rel_path)
            base_name, _ = os.path.splitext(filename)
            
            # Reconstruct the matching funscript path in the funscript directory
            funscript_path = os.path.join(funscript_dir, rel_dir, base_name + ".funscript")

            if not os.path.exists(funscript_path):
                continue

            # Get times
            v_sec = get_video_duration(video_path)
            s_sec = get_script_duration(funscript_path)

            if v_sec is not None and s_sec is not None:
                delta = v_sec - s_sec
                results.append({
                    'name': filename,
                    'v_sec': v_sec,
                    's_sec': s_sec,
                    'delta': delta
                })

    # 3. Sort by greatest delta first
    results.sort(key=lambda x: x['delta'], reverse=True)

    # Print results
    print(f"{'File Name':<45} | {'Video':<8} | {'Script':<8} | {'Delta (Gap)':<15}")
    print("-" * 85)
    
    for item in results:
        # Limit filename display to 45 characters to keep layout clean
        short_name = item['name'] if len(item['name']) <= 45 else item['name'][:42] + "..."
        print(f"{short_name:<45} | {item['v_sec']:>6}s | {item['s_sec']:>6}s | {item['delta']:>5}s shorter")

if __name__ == '__main__':
    main()
