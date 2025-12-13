# Interactive Video Player

A web-based video player application built with Rust and JavaScript that synchronizes video playback with hardware devices using funscript files.

## Features

- Video playback with funscript synchronization
- Real-time intensity visualization
- Adjustable intensity settings
- Directory browser for video selection
- WebSocket-based device control
- Fullscreen support

## Project Structure

- `src/`
  - `main.rs` - Server entry point and configuration
  - `handlers/` - HTTP request handlers for different routes
    - `index.rs` - Handler for the main index page
    - `video.rs` - Handler for video streaming
    - `funscript.rs` - Handler for funscript files
    - `metadata.rs` - Handlers for video metadata
  - `directory_browser.rs` - File system navigation
  - `buttplug/`
    - `device_manager.rs` - Device connection and control
    - `funscript_utils.rs` - Funscript parsing and processing
- `static/`
  - `video_player.js` - Core video player implementation
  - `funscript_handler.js` - Funscript data management
  - `funscript_sliders.js` - Visualization components
  - `settings_menu.js` - User settings interface
  - `socket.js` - WebSocket communication
  - `styles.css` - Application styling

## Setup

1. Install Rust and Cargo
2. Create a `.env` file with:  
```txt
VIDEO_SHARE_PATH="\\\\your-network-drive\\your-folder"
HOST_IP=192.168.???.???
```  
note: when running inside docker, use 
```txt
HOST_IP=0.0.0.0
```  
3. (Optional) Create a `predefined_tags.txt` file in the project root to customize the default list of tags. Each tag should be on a new line.

## Device Integration

The application uses the Buttplug protocol for device control. Make sure to:

1. Run [Intiface Central](https://intiface.com/central/) on port `12345`
2. Connect compatible devices (only tested with HISMITH)

## Running

To build and run the project, ensure you have Rust and Cargo installed. Then, navigate to the project directory and run:

```bash
cargo run
```

This will start the web server, and you can access the application in your web browser.
`http://HOST_IP:5441/site`

## Running with docker

If making code changes:

```bash
docker rm -f my-rust-app
docker build -t rust-website:v1 .
```

First run:

```bash
docker run --network=host -d -p 5441:5441 \
  -v [YOUR_VIDEO_SHARE_PATH]:YOUR_VIDEO_SHARE_PATH:ro \
  --name my-rust-app rust-website:v1
```

Stopping/starting sequential runs:

```bash
docker stop my-rust-app
docker start my-rust-app
```

This will start the web server, and you can access the application in your web browser.
`http://HOST_IP:5441/site`


## License

This project is licensed under the MIT License. See the LICENSE file for more details.