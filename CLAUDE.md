# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development & Build
- `npm run dev` - Start development server on all interfaces (0.0.0.0:3000)
- `npm run build` - Production build (standalone output for Docker)
- `npm run start` - Start production server
- `npm run lint` - Run ESLint on source code

### Database Operations
- `npx prisma migrate dev` - Apply database migrations
- `npx prisma db seed` - Seed database with initial data (admin user + knowledge tags)
- `npx prisma studio` - Open Prisma Studio for database inspection

### Testing
- `npm run test` - Run all Vitest tests
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:coverage` - Generate coverage report
- `npm run test:e2e` - Run Playwright E2E tests
- `npm run test:report` - View Playwright test report

### Utility Scripts
- `node scripts/reset-password.js <email> <new-password>` - Reset user password

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 16 (App Router) + React 19
- **Database**: SQLite with Prisma ORM 5.22
- **Authentication**: NextAuth.js v4 (credentials provider, bcryptjs)
- **AI Services**: Google Gemini / OpenAI / Azure OpenAI (runtime configurable)
- **UI**: Tailwind CSS v4 + Shadcn UI (Radix primitives)
- **Testing**: Vitest (unit/integration) + Playwright (E2E)

### Core Application Flow
```
Upload Image → Crop/Compress → POST /api/analyze → AI Analysis → Edit/Confirm → Save to Database
```

### Key Architectural Patterns

#### AI Service Abstraction
The application uses a factory pattern for AI services (`src/lib/ai/index.ts`). The `getAIService()` function returns the appropriate provider instance based on runtime configuration:
- `GeminiProvider` - Google Gemini API
- `OpenAIProvider` - OpenAI API (supports multi-instance configuration)
- `AzureOpenAIProvider` - Azure OpenAI Service

All providers implement the `AIService` interface with methods:
- `analyzeImage()` - Parse uploaded images into structured question data
- `generateSimilarQuestion()` - Generate practice questions
- `reanswerQuestion()` - Re-solve questions with explanations
- `analyzeForGeogebra()` - Generate GeoGebra commands for interactive demos

#### Configuration System
Three-tier configuration priority:
1. **config/app-config.json** (highest) - Runtime config via web UI, persists to disk
2. **Environment variables** (.env) - Static configuration at startup
3. **DEFAULT_CONFIG** (code defaults) - Fallback values

Critical: `config/app-config.json` stores API keys in plaintext and overrides environment variables. This allows dynamic AI provider switching without server restart.

#### Knowledge Tag System
Hierarchical knowledge tagging using adjacency list pattern:
- System tags (10 subjects, seeded in `prisma/seed.ts`)
- User custom tags (per-user, subject-specific)
- Infinite depth hierarchy via `parentId` self-relation
- AI analysis injects relevant tags into prompts for standardization

#### Authentication Flow
- NextAuth.js credentials provider with bcryptjs password hashing
- Middleware (`src/middleware.ts`) protects non-API routes
- Role-based access control: `user` vs `admin` role
- Admin-only routes under `/admin` prefix

### Database Schema Highlights

**Core Models:**
- `User` - Authentication, education stage, enrollment year, role
- `Subject` - User's notebooks (错题本)
- `ErrorItem` - Individual mistakes with AI analysis and tags
- `KnowledgeTag` - Hierarchical knowledge points with system/user distinction
- `PracticeRecord` - Practice session tracking

**Key Relationships:**
- User → Subject (one-to-many) - Each user has multiple notebooks
- Subject → ErrorItem (one-to-many) - Notebook contains mistakes  
- ErrorItem ↔ KnowledgeTag (many-to-many) - Tagged with knowledge points
- KnowledgeTag → KnowledgeTag (self-relation) - Hierarchical structure

### Directory Structure Notes

**AI Integration:**
- `src/lib/ai/` - AI service layer with provider implementations
- `src/lib/ai/prompts.ts` - XML-based prompt templates (not JSON, reduces AI format errors)
- `src/lib/ai/schema.ts` - Zod validation for AI responses
- `src/lib/tag-data/` - Pre-seeded knowledge tags by subject

**API Routes:**
- `/api/analyze` - Image analysis endpoint
- `/api/error-items` - CRUD operations for mistakes
- `/api/ai/models` - List available AI models
- `/api/settings` - Read/write runtime configuration
- `/api/admin/*` - Admin-only user management

**Configuration & Logging:**
- `src/lib/config.ts` - Configuration file I/O (uses synchronous fs operations)
- `src/lib/logger.ts` - Custom structured logger (development: colored, production: JSON)
- `src/lib/knowledge-tags.ts` - Grade calculation and subject inference
- `src/lib/grade-calculator.ts` - Academic year calculations

## Development Guidelines

### Adding New AI Features
1. Update `AIService` interface in `src/lib/ai/types.ts`
2. Implement in all three provider classes (Gemini, OpenAI, Azure)
3. Add XML-based prompt template in `src/lib/ai/prompts.ts`
4. Update Zod schema in `src/lib/ai/schema.ts` for response validation

### Database Schema Changes
1. Modify `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name <description>`
3. Update `seed.ts` if adding default data
4. Consider migration impact on existing config/app-config.json

### Testing Requirements
- Unit tests for utilities, AI providers, API routes
- Integration tests for API endpoints with database
- E2E tests for critical user flows (upload, analyze, edit)
- Minimum 80% coverage threshold enforced

### Known Issues to Address
- `config.ts` uses synchronous file operations (may block event loop)
- Custom logger lacks buffering/rotation for high-volume production use
- `app-config.json` stores API keys in plaintext
- AI prompts inject full tag lists (high token consumption)
- Consider async config loading and buffered logging for production optimization

### Important Constraints
- Database: SQLite only (not PostgreSQL/MySQL) - uses better-sqlite3 adapter
- Authentication: Credentials provider only (no OAuth configured)
- AI Analysis: Requires user grade/subject context for accurate tagging
- Deployment: Docker standalone output only (not Vercel/Netlify)
