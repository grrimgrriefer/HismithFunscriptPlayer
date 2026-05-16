# ---- Build Stage ----
FROM rust:latest as builder

WORKDIR /app

# Install system dependencies for rusqlite (bundled feature should help, but just in case)
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev libdbus-1-dev libudev-dev && \
    rm -rf /var/lib/apt/lists/*

# Install cargo-audit for security scanning
RUN cargo install --locked cargo-audit

# Copy manifests first for caching
COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Build dependencies first for better caching
RUN cargo fetch

# Run cargo-audit and fail the build if vulnerabilities are found
RUN cargo audit

# Build the application in release mode
RUN cargo build --release

# ---- Runtime Stage ----
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies (for rusqlite and others)
RUN apt-get update && apt-get install -y libsqlite3-0 ca-certificates && rm -rf /var/lib/apt/lists/*

# Create a non-privileged user and group
RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -s /bin/sh appuser

# Copy the compiled binary and change ownership to the new user
COPY --from=builder --chown=appuser:appuser /app/target/release/hismith-player-site /app/hismith-player-site
COPY --chown=appuser:appuser static ./static
COPY --chown=appuser:appuser .env .env

# Tell Docker to run as this user by default
USER appuser

# Expose the port your app listens on (default: 5441)
EXPOSE 5441

# Set environment variables if needed (optional)
ENV RUST_LOG=info

# Run the application
CMD ["./hismith-player-site"]