# PPT Style Configuration

This file is the shared configuration for the `ppt` skill.

Update it directly when the team wants new defaults for presentations created from this repository.

---

## Default Profile

- **Team or org**: [Replace with team name]
- **Primary use**: Internal stakeholder decks, executive summaries, and workbook-to-story presentations
- **Default audience**: Leadership
- **Preferred tone**: Professional, concise, outcome-first
- **Default deck length**: 8-12 slides
- **Text density**: Balanced
- **Visual bias**: Prefer comparisons, process flows, summary cards, and timelines over long bullet lists
- **Theme**: modern-blue

## Audiences

### Leadership
- **What they care about**: Outcomes, risks, decisions, dependencies, next steps
- **Detail level**: Big picture with selective evidence
- **Preferred sections**: Executive summary, key decisions, risks, roadmap, appendix
- **What to avoid**: Deep implementation detail on core slides

### Product And Business Stakeholders
- **What they care about**: Customer value, workflow impact, tradeoffs, scope, milestones
- **Detail level**: Moderate detail
- **Preferred sections**: Problem, approach, user flow, comparison, milestones, open questions
- **What to avoid**: Low-level technical terminology unless it changes product risk or delivery

### Engineering And Architecture
- **What they care about**: System flow, dependencies, constraints, implementation options, risks
- **Detail level**: Moderate to detailed
- **Preferred sections**: Context, architecture flow, decision points, integration impacts, delivery sequencing
- **What to avoid**: Marketing language and vague claims without evidence

## Presentation Rules

- Open with a strong title and a one-slide executive frame when the audience is not purely technical.
- Avoid more than two dense bullet slides in a row.
- Prefer one message per slide.
- Use section breaks for major narrative shifts.
- Use comparison slides for options and before/after states.
- Use process-flow, roadmap, timeline, or summary slides wherever they communicate better than bullets.
- Keep appendix material out of the main flow unless the user explicitly asks for a detailed deck.

## Brand And Voice

- **Voice**: Clear, credible, direct, low-hype
- **Terminology rules**: Use project and domain terms exactly as supplied by the source material
- **Formatting preference**: Short slide titles, tight bullets, explicit labels for risks and decisions
- **Avoid**: Generic consulting filler, repeated adjectives, vague strategic language, empty summary slides

## Preferred Deck Archetypes

- Executive update
- Decision deck
- Technical review
- Workbook-to-storyboard
- Meeting summary deck
- Roadmap presentation

## Revision Preferences

- If the user asks for a shorter deck, compress to fewer slides before shrinking text size.
- If the user asks for an executive version, reduce implementation detail and increase decisions, risks, and outcomes.
- If the user asks for a more visual version, replace generic content slides with comparison, process-flow, summary, timeline, or infographic-style slides.