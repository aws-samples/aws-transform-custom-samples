# AWS Transform CLI Container - All Languages
# Production-ready container with Java, Python, Node.js, and all common tools

# Amazon Linux 2023 base image (required for public ECR compliance)
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

ENV TZ=UTC

# Install base dependencies from dnf
RUN dnf install -y \
    git \
    tar \
    gzip \
    unzip \
    jq \
    ca-certificates \
    gcc \
    gcc-c++ \
    make \
    patch \
    openssl-devel \
    bzip2-devel \
    libffi-devel \
    zlib-devel \
    readline-devel \
    sqlite-devel \
    xz-devel \
    && dnf clean all

# Install AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf aws awscliv2.zip

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash atxuser

# Create working directories
RUN mkdir -p /source /output /app /usr/local/bin && \
    chown -R atxuser:atxuser /source /output /app

# ============================================================================
# JAVA - Amazon Corretto (8, 11, 17, 21, 25) + Maven + Gradle
# ============================================================================
# Install Amazon Corretto versions from dnf
RUN dnf install -y \
    java-1.8.0-amazon-corretto-devel \
    java-11-amazon-corretto-devel \
    java-17-amazon-corretto-devel \
    java-21-amazon-corretto-devel \
    java-25-amazon-corretto-devel \
    maven \
    && dnf clean all

# Set default Java version to Corretto 17
ENV JAVA_HOME=/usr/lib/jvm/java-17-amazon-corretto.x86_64
ENV MAVEN_HOME=/usr/share/maven
ENV PATH="$JAVA_HOME/bin:$MAVEN_HOME/bin:$PATH"

# ============================================================================
# GRADLE - direct install with checksum verification
# ============================================================================
ENV GRADLE_VERSION=9.4.1
ENV GRADLE_HOME=/opt/gradle/gradle-${GRADLE_VERSION}
ENV GRADLE_SHA256=2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb

RUN curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
    && echo "${GRADLE_SHA256}  /tmp/gradle.zip" | sha256sum -c - \
    && mkdir -p /opt/gradle \
    && unzip -q /tmp/gradle.zip -d /opt/gradle \
    && rm /tmp/gradle.zip

ENV PATH="${GRADLE_HOME}/bin:$PATH"

# ============================================================================
# PYTHON - dnf (3.11, 3.12, 3.13) + pyenv (3.8, 3.9, 3.10, 3.14)
# ============================================================================
USER root
RUN dnf install -y python3.11 python3.11-pip python3.12 python3.13 && dnf clean all

# Set Python 3.11 as default python3 (required for MCP servers)
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --set python3 /usr/bin/python3.11

# Install older versions and 3.14 via pyenv (built from source)
USER atxuser
ENV PYENV_ROOT=/home/atxuser/.pyenv
ENV PATH="$PYENV_ROOT/bin:$PATH"

RUN git clone --depth 1 --branch v2.6.21 https://github.com/pyenv/pyenv.git $PYENV_ROOT && \
    eval "$(pyenv init -)" && \
    MAKE_OPTS="-j$(nproc)" pyenv install 3.8.18 && \
    MAKE_OPTS="-j$(nproc)" pyenv install 3.9.18 && \
    MAKE_OPTS="-j$(nproc)" pyenv install 3.10.13 && \
    MAKE_OPTS="-j$(nproc)" pyenv install 3.14.3

# Install Python packages
COPY --chown=atxuser:atxuser requirements.txt /tmp/
RUN python3.11 -m pip install --user --no-cache-dir -r /tmp/requirements.txt

ENV PATH="/home/atxuser/.local/bin:$PATH"

# ============================================================================
# NODE.JS - Multiple versions via nvm (16, 18, 20, 22, 24)
# ============================================================================
ENV NVM_DIR=/home/atxuser/.nvm

# Install nvm
RUN git clone https://github.com/nvm-sh/nvm.git $NVM_DIR && \
    cd $NVM_DIR && git checkout v0.39.7

# Install Node.js versions and create symlink
RUN . $NVM_DIR/nvm.sh && \
    nvm install 16 && \
    nvm install 18 && \
    nvm install 20 && \
    nvm install 22 && \
    nvm install 24 && \
    nvm alias default 20 && \
    nvm use default && \
    cd $NVM_DIR/versions/node && \
    ln -sf $(ls -d v20.* | head -1) default

# Add default Node.js to PATH (uses symlink)
ENV PATH="$NVM_DIR/versions/node/default/bin:$PATH"

# Install npm packages with pinned versions for all Node.js versions
RUN . $NVM_DIR/nvm.sh && \
    for v in 16 18 20 22 24; do \
      nvm use "$v" && \
      npm install -g yarn@1.22.21 pnpm@8.15.1 typescript@5.3.3 ts-node@10.9.2; \
    done && \
    nvm use default

# ============================================================================
# CUSTOM LANGUAGES AND TOOLS
# ============================================================================
# Add additional languages, compilers, or tools here. Insert
# new RUN commands in this section when the user needs a language not included
# by default.
#
# IMPORTANT: Do NOT use dnf in this section — pyenv overrides the system
# python3 that dnf depends on, causing "No module named 'dnf'" errors.
# Use language-specific version managers instead (nvm, pyenv, rbenv).
#
# Examples:
#   USER atxuser
#   RUN bash -c "source /home/atxuser/.nvm/nvm.sh && nvm install 23"
#   USER root
#
#   RUN curl -fsSL https://go.dev/dl/go1.22.0.linux-amd64.tar.gz | tar -C /usr/local -xz
#
# After editing, redeploy with: ./setup.sh
# CDK auto-detects Dockerfile changes and rebuilds the image.
# ============================================================================

USER root

# ============================================================================
# CONTAINER SCRIPTS
# ============================================================================
COPY --chown=atxuser:atxuser entrypoint.sh /app/
COPY --chown=atxuser:atxuser download-source.sh /app/
COPY --chown=atxuser:atxuser upload-results.sh /app/

RUN chmod +x /app/*.sh

# ============================================================================
# AWS TRANSFORM CLI
# ============================================================================
USER atxuser

# Install AWS Transform CLI (only curl-based install allowed for ATX CLI)
# Download over HTTPS from AWS-owned domain; verify binary exists after install
RUN curl -fsSL https://transform-cli.awsstatic.com/install.sh | bash && \
    test -f /home/atxuser/.local/bin/atx

# Add ATX to PATH
ENV PATH="/home/atxuser/.local/bin:$PATH"

WORKDIR /source

# Health check - verify ATX CLI binary exists
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD test -f /home/atxuser/.local/bin/atx || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]

# ============================================================================
# METADATA
# ============================================================================
LABEL maintainer="AWS Transform CLI"
LABEL description="Production-ready container with Amazon Corretto Java, Python, Node.js for AWS Transform CLI"
LABEL version="1.0"
LABEL languages="java-8,11,17,21,25-corretto python-3.8-3.14 nodejs-16,18,20,22,24"
