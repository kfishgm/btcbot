# Setup PRD Command

Create a comprehensive Product Requirements Document (PRD) for the project by collecting information and populating template files.

**IMPORTANT**: This command should be run AFTER `/setup-project` but BEFORE development begins. It requires the project name to already be configured.

## Information Collection Process

Collect the following information from the user in a conversational manner. For each section, provide examples and allow the user to provide detailed responses.

### 1. Product Overview
- **Product Name**: Already set, confirm with user
- **Product Type**: What kind of application? (e.g., "E-commerce platform", "Social media app", "Developer tool")
- **Brief Description**: One paragraph explaining what the product does
- **Target Audience**: Who will use this? Be specific (e.g., "Software developers working in teams" not just "developers")
- **Unique Value Proposition**: What makes this different/better than alternatives?

### 2. Objectives and Goals
Ask for 3-5 primary objectives. Examples:
- "Enable users to collaborate on code in real-time"
- "Reduce deployment time by 50%"
- "Provide analytics dashboard for user behavior"

Also ask for success metrics for each objective.

### 3. User Roles and Stories
- **User Types**: List all user roles (e.g., Guest, Registered User, Admin, Premium User)
- For each role, collect:
  - What they can do
  - What they cannot do
  - Their primary goals

### 4. Core Features
Organize features by category. For each feature collect:
- **Feature Name**
- **Description**
- **Priority** (High/Medium/Low for MVP)
- **Acceptance Criteria** (how to know it's done)

Common categories:
- Authentication & User Management
- Core Functionality (specific to the product)
- Admin Features
- Analytics & Reporting
- Settings & Preferences

### 5. Technical Requirements
- **Performance**: Expected load, response times, concurrent users
- **Security**: Data protection needs, compliance requirements
- **Accessibility**: WCAG level, browser support
- **Scalability**: Expected growth over 6-12 months

### 6. Technical Stack (confirm defaults or customize)
- Frontend: Next.js 15 (default)
- Styling: Tailwind CSS v4 (default)
- Database: Supabase PostgreSQL (default)
- Authentication: Supabase Auth (default)
- File Storage: Supabase Storage (default)
- Additional Services: Any third-party APIs?

### 7. API Design
- List main resources/entities (e.g., User, Post, Comment)
- For each resource, confirm CRUD operations needed
- Any special endpoints or operations?

### 8. Timeline and Phases
- **MVP Target**: How many weeks/months?
- **Phase 1**: Core features (what's included?)
- **Phase 2**: Enhanced features
- **Phase 3**: Nice-to-have features

### 9. Constraints and Risks
- **Out of Scope**: What won't be in MVP?
- **Technical Risks**: Potential challenges
- **Mitigation**: How to handle risks

## File Generation Process

After collecting all information, generate the following files:

### 1. Generate PRD.md
Replace the template content in `docs/templates/PRD.md` with actual project information:
- Do NOT overwrite the template
- Create `docs/PRD.md` as the actual PRD
- Fill all sections with collected information
- Remove any template placeholders

### 2. Generate tasks.md
Create `docs/tasks.md` with:
- Organized task categories based on features
- Numbered tasks (CATEGORY-XXX format)
- Priority levels
- Clear descriptions
- Dependencies marked

Task numbering scheme:
- CORE-001 to CORE-099: Core functionality
- AUTH-001 to AUTH-020: Authentication
- USER-001 to USER-020: User management
- API-001 to API-030: API development
- UI-001 to UI-050: UI/UX tasks
- TEST-001 to TEST-030: Testing tasks
- DOCS-001 to DOCS-020: Documentation
- DEPLOY-001 to DEPLOY-010: Deployment

### 3. Generate dashboard.md
Create `docs/dashboard.md` with:
- Project name and description
- Timeline with phases
- Team structure (even if solo)
- Links section (GitHub, deployment URLs if known)
- Initial metrics (all at 0%)

### 4. Generate progress.md
Create `docs/progress.md` with:
- Week 1 entry with PRD completion
- Empty sections for upcoming weeks
- Milestone tracking based on phases

### 5. Update README.md
Create `docs/README.md` as the main project documentation:
- Project overview
- Getting started instructions
- Architecture overview
- Development workflow
- Link to other docs

## Success Confirmation

After generating all files, show the user:
1. List of files created
2. Summary of project setup
3. Next steps:
   - Review generated PRD
   - Adjust tasks if needed  
   - Run `/setup-agents` when ready for multi-agent workflow
   - Start development with `/next-task`

## Important Notes

- Be thorough but not overwhelming
- Provide sensible defaults when user is unsure
- Allow user to review and confirm before generating files
- Ensure consistency across all generated documents
- Keep templates intact for future projects