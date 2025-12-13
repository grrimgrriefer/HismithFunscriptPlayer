# ---- Build Stage ----
FROM rust:latest as builder

WORKDIR /app

# Install system dependencies for rusqlite (bundled feature should help, but just in case)
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev libdbus-1-dev libudev-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy manifests first for caching
COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Build dependencies first for better caching
RUN cargo fetch

# Build the application in release mode
RUN cargo build --release

# ---- Runtime Stage ----
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies (for rusqlite and others)
RUN apt-get update && apt-get install -y libsqlite3-0 ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from builder
COPY --from=builder /app/target/release/rust-website /app/rust-website

# Copy static files and .env
COPY static ./static
COPY .env .env

# Expose the port your app listens on (default: 5441)
EXPOSE 5441

# Set environment variables if needed (optional)
ENV RUST_LOG=info

# Run the application
CMD ["./rust-website"]