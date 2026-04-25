# MIPS Visual Simulator Pipeline

A JavaScript-based MIPS simulator that can simulate the MIPS assembly code with visual pipeline representation.

### Prerequisites
- Docker and Docker Compose installed
- Node.js (for development mode)

### Running with Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd mips_pipeline_viewer
   ```

2. **Run with Docker Compose (simplest method):**
   ```bash
   docker-compose up -d
   ```
   
   Your application will be available at: http://localhost:3000

3. **Useful Docker Compose commands:**
   ```bash
   # Stop the application
   docker-compose stop
   
   # Stop and remove containers
   docker-compose down
   
   # View logs
   docker-compose logs
   
   # Rebuild and run (after code changes)
   docker-compose up --build -d
   ```

### Development Mode

To run in development mode with hot reload:

```bash
cd app
npm install
npm run dev
```

The development server will start at: http://localhost:3000

### Manual Docker Build (Alternative)

If you prefer manual Docker commands:

```bash
# Build the image
docker build -t mips-pipeline-viewer .

# Run the container
docker run -p 3000:3000 -d --name mips-pipeline mips-pipeline-viewer
```