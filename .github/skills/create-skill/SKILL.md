---
name: create-skill
description: "Workspace skill to create or update a reusable SKILL.md file for VS Code agent customization in this repository."
user-invocable: true
---

# Workspace Skill Creator

## Purpose
This skill guides the creation of a workspace-scoped `SKILL.md` file for VS Code agent customization. It packages a full multi-step workflow to ensure the skill is properly scoped, documented, and compatible with the repository.

## When to use
Use this skill when you need to create or refine a reusable, project-specific skill in this repo that encapsulates a deterministic workflow, quality criteria, and precise implementation guidance.

## Workflow
1. Confirm the target outcome and whether the skill should be workspace-scoped.
2. Inspect the repository for existing customization patterns and preferred skill locations.
3. Choose a workspace-safe placement, typically `.github/skills/<skill-name>/SKILL.md`.
4. Draft YAML frontmatter with:
   - `name`
   - `description`
   - `user-invocable: true`
5. Write the body with:
   - purpose and scope
   - decision guidance and applicable use cases
   - step-by-step actions
   - examples of how to invoke the skill
6. Validate the skill file:
   - YAML frontmatter syntax
   - file location and naming
   - clarity of instructions
7. Save the file and confirm the path.

## Validation Checklist
- [ ] Skill is workspace-scoped and stored in `.github/skills/`
- [ ] Frontmatter syntax is valid YAML
- [ ] `description` is clear and triggerable
- [ ] `user-invocable` is set to `true`
- [ ] Instructions match the repository's customization conventions
- [ ] The skill is not duplicated elsewhere in the repo

## Example Prompts
- "Create a workspace SKILL.md for reviewing API route changes."
- "Draft a reusable skill for documenting new endpoint implementations."
- "Generate a repository-scoped SKILL.md for secure backend/frontend integration workflows."
