---
name: ppt
description: 'Create polished PowerPoint presentations and reusable PPT guidance for this repository. Use when users want deck style setup, executive or leadership decks, meeting summary presentations, technical review decks, roadmap presentations, workbook-to-PPT conversion, or premium slide refinement.'
---

# PPT

Use this skill for PowerPoint work in this repository.

## When To Use This Skill

Use this skill when:
- A user asks for a presentation, PowerPoint, slide deck, or PPTX
- A user wants an executive deck, leadership deck, polished deck, stakeholder deck, roadmap deck, or meeting summary deck
- A user wants workbook-to-PPT conversion or a report turned into slides
- A user wants to configure deck style, presentation tone, audience preferences, or reusable PowerPoint standards

Keywords: PowerPoint, PPT, presentation, presentations, slide, slides, slide deck, deck, executive deck, executive presentation, leadership deck, polished deck, tier-1 deck, presentation style, deck style, PowerPoint style, brand deck, configure presentation, setup presentation, generate presentation, create slides, generate PPTX, workbook to PowerPoint, roadmap presentation, technical review deck

## What This Skill Covers

This skill combines two responsibilities in one folder-based skill:
- presentation setup and calibration
- polished PPT generation

## First Check

Read [references/ppt-style-config.md](references/ppt-style-config.md) before planning the deck.

If the style config is clearly incomplete for the requested output, ask the user whether they want to continue now or refine the style first.

## Workflow

1. If the user is asking for style setup, ask only for information that materially changes deck quality:
   - target audiences
   - preferred tone
   - slide density
   - expected sections
   - what to avoid
2. If the user is asking for a deck, identify the source type:
   - prompt-only brief
   - workbook or report
   - meeting notes
   - Jira or project summary
   - existing deck rewrite
3. If files are attached, inspect them before shaping the deck.
4. Use [references/ppt-style-config.md](references/ppt-style-config.md) to determine audience, tone, and slide style.
5. Build the deck as a story, not a data dump.
6. Prefer strong slide variety:
   - title
   - summary
   - section break
   - comparison
   - process flow
   - timeline
   - roadmap
   - supporting appendix where needed
7. Use the repository's existing document-generation tooling to render the final PPTX.
8. After generation, summarize what was created and offer revision directions such as shorter, more executive, more technical, or more visual.

## Requirements

- Always align with [references/ppt-style-config.md](references/ppt-style-config.md).
- Prefer one clear message per slide.
- Avoid long runs of bullet-only slides.
- Avoid generic filler language.
- When converting spreadsheets into decks, translate rows into narrative, comparisons, risks, flows, and decisions.
- If the audience is leadership, compress implementation detail into appendix or support slides.

## References

- Style config: [references/ppt-style-config.md](references/ppt-style-config.md)
- Style config template: [references/style-config-template.md](references/style-config-template.md)
- Deck archetypes: [references/deck-archetypes.md](references/deck-archetypes.md)
- Premium deck rules: [references/premium-deck-rules.md](references/premium-deck-rules.md)