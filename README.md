# Interactive Video Player

[![CodeQL](https://github.com/grrimgrriefer/HismithFunscriptPlayer/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/grrimgrriefer/HismithFunscriptPlayer/actions/workflows/github-code-scanning/codeql)
[![Dependabot Updates](https://github.com/grrimgrriefer/HismithFunscriptPlayer/actions/workflows/dependabot/dependabot-updates/badge.svg)](https://github.com/grrimgrriefer/HismithFunscriptPlayer/actions/workflows/dependabot/dependabot-updates)

A web-based video player (Rust + Actix + plain JS) that synchronizes video playback with oscillating (and vibrating) hardware devices.

## Features

- Video playback with funscript synchronization.
- Real-time intensity visualization.
- Multi-step calibration, to synch with attachments with various amounts of 'friction'.
- Directory browser for video selection.
- WebSocket-based device control for minimal latency.
- Editor mode to create / modify funscripts directly from the browser.

> [!IMPORTANT]  
> Note: The app expects funscript actions with pos values 0 or 100. Other values are not (currently) supported.

## Quick start

1. Run [Intiface Central](https://intiface.com/central/) on port `12345`
2. Create a `.env` in the project root:

```bash
# base folder for video files served by the app
VIDEO_SHARE_PATH="/absolute/path/to/videos" 
# base folder for funscript files .funscript
FUNSCRIPT_SHARE_PATH="/absolute/path/to/funscripts"
# 0.0.0.0 when using docker, or your host LAN IP when running outside container
HOST_IP=0.0.0.0 (docker) or your LAN IP
```

3. Build & run:

```bash
cargo run
```

or when running in a docker container:

```bash
docker stop hismith-player || true && \
docker rm -f hismith-player || true && \
docker build -t hismith-player-site:v1 . && \
docker run -d -p 5441:5441 \
# make sure the user has read permissions to readonly volume and write permissions to funscript volume
 --user "$(id -u):$(id -g)" \
 --mount type=bind,source=/absolute/path/to/videos,target=/absolute/path/to/videos,readonly \
 --mount type=bind,source=/absolute/path/to/funscripts,target=/absolute/path/to/funscripts \
 --name hismith-player hismith-player-site:v1
```

Open the client in your browser at http://HOST_IP:5441/site/

4. Connect compatible devices to Intiface (only tested with HISMITH and Wildolo)  
_The host device_manager will repeatedly try to connect to Intiface and to start scanning if devices are missing._

## Project Structure

- `src/`
  - `buttplug/`
    - `device_manager.rs`  
      
      Manages Buttplug client, device discovery, scanning loop, and a periodic control loop that sends latest intensity values to oscillate/vibrate devices. Exposes initialize_intiface() for startup and synchronous helpers (e.g. oscillate_sync() and vibrate_sync()) that are invoked by the WebSocket actor.
    - `funscript_utils.rs`  
      
      Core funscript data types and processing utilities. E.g. interpolation helpers, condensing identical positions, and calculating thrust intensity by converting discrete 0/100 actions into a continuous intensity curve used for device control/visualization.
  - `handlers/`
    - `calibration.rs`  
      
      Serves the calibration page HTML.
    - `editor.rs`  
      
      Serves editor UI and implements POST `/api/funscripts` to save uploaded funscript JSON. Validates paths to prevent directory traversal and writes files under FUNSCRIPT_SHARE_PATH.
    - `funscript.rs`  
      
      Loads a `.funscript` from FUNSCRIPT_SHARE_PATH, attempts to generate an intensity funscript (via funscript_utils), and returns JSON payload:  
      { original: Option\<FunscriptData\>, intensity: Option\<FunscriptData\> }.
    - `index.rs`  
      
      Serves the SPA index page and provides `/api/directory-tree` endpoint that returns the directory JSON (uses directory_browser).
    - `video.rs`  
      
      Streams files from VIDEO_SHARE_PATH via actix_files::NamedFile. Configured to prioritized client performance.
  - `directory_browser.rs`  
    
    Scans VIDEO_SHARE_PATH and builds JSON tree used by the front-end directory UI. Provides `build_directory_tree` and `get_all_files_with_size`. Skips "funscripts" directories and filters by common video extensions.
  - `intiface_socket.rs`  
    
    Actix WebSocket actor to receive JSON commands from the browser and forward them to the device manager. Expects JSON like { "o": <f64>, "v": <f64> } where values are normalized in the 0.0..1.0 range; the server clamps values before forwarding. Non-JSON or binary payloads produce structured JSON error replies.
  - `lib.rs`  
    
    Exports modules and organizes the crate structure.
  - `main.rs` 
    
    Program entrypoint: loads .env, initializes logging, spawns intiface/device initialization, configures and starts Actix HTTP server on HOST_IP:5441.
  - `routes.rs`  
    
    Registers all HTTP endpoints and static file serving. Scope `/site` contains main UI and static assets; `/api` contains server APIs; `/ws` is the WebSocket.

- `static/`
  - `calibration.html / .js`  
    
    Calibration overlay UI and logic: allows mapping screen intensity presets to device multipliers and sends test commands via WebSocket.
  - `directory_tree.js`  
    
    Renders the file tree UI and launches video playback when a file is selected.
  - `editor.html / .js`  
    
    In-browser funscript editor: tap-based point creation, drag/selection editing, and saving on the host via API.
  - `funscript_display_graphs.js`  
    
    Visualization for intensity curve & beat markers. (canvas-based)
  - `funscript_handler.js`  
    
    Client-side funscript loader and utilities: maintains original/actions and intensity arrays, interpolation helpers, max/clamping behavior, vibrate modes.
  - `index.html`  
    
    Main entry page.
  - `main.js`  
    
    Initializes main UI, fetches directory tree, sets up WebSocket.
  - `settings_menu.js`  
    
    Builds settings UI overlay: max intensity limit, vibrate mode, open editor, open calibration overlay.
  - `socket.js`  
    
    WebSocket wrapper used by the front-end; connects to ws://\<host\>:5441/ws and sends { o, v } payloads.
  - `styles.css`  
    
    UI Styling
  - `video_player.js`  
    
    Core player logic: creates \<video\>, loads funscript, updates UI per frame, sends device commands based on current intensity.

## API overview

- GET /site/  
  UI index
- GET /site/static/*  
  Static assets (JS, CSS, HTML)
- GET /site/video/{filename:.*}  
  Streams a video file from VIDEO_SHARE_PATH
- GET /site/funscripts/{filename:.*}  
  Returns JSON: { original, intensity }
- POST /api/funscripts  
  Saves a funscript (used by editor). Body: { video_path: String, actions: [Action] }
- GET /api/directory-tree  
  Returns JSON file tree for VIDEO_SHARE_PATH
- WebSocket ws://HOST_IP:5441/ws  
  JSON control messages { o: 0..1, v: 0..1 } to control devices

## Funscript format

A funscript is JSON with:  
- version, range, metadata
- actions: [{ at: \<ms\>, pos: <0..100> }, ...]  

Conventions in this project:  
- Editor and intensity generator expect discrete pos values of 0 (retracted) or 100 (thrust).
- Intensity generator computes a continuous 0..100 intensity value sampled periodically.

NOTE: External funscripts that have values between 0-100 must be normalized before importing.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.
