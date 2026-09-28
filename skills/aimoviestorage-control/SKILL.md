---
name: aimoviestorage-control
description: Use the locally running AIMovieStorage app through its controller to develop a film or music-video project across Codex chats, including shot planning, generation, and registering every created prompt, image, and video in the app.
---

# AIMovieStorage project work

Use this skill when the user wants to create or continue an AIMovieStorage drama, music video, scene, or shot from a Codex chat. Work in the user's named project; ask which project only if the app lists several plausible matches and the choice changes the work.

## Connect and inspect

The desktop app must be running with **Settings → 대화로 앱 조종하기 → 앱 조종 켜기**. Connect Codex to the app's local `aimoviestorage` MCP server using the command shown in that Settings screen. The installed skill does not configure Codex MCP or start the app for the user. Check the connected server's `tools/list` and `app_status`; available commands depend on the installed edition and version. If it is unavailable, say what connection step is missing, and continue any useful offline preparation.

Start each work session with `projects_list`, then `project_get` for the chosen project. Read current IDs, values, and revision before editing. After the user edits in the app, read `project_changes` or `composition_changes` since the last revision; if history is incomplete, get a fresh full snapshot. Incorporate those edits instead of replaying stale commands. Pass the current `expectedRevision` to writes. A revision conflict means read again and re-plan, not blind retry.

## Build and verify

Use `project_update` for story, characters, backgrounds, scenes, cuts and text prompts. For the shot planner, open the appropriate cut, apply supported `composition_apply` commands, capture when needed, and commit the composition. The composition's in-memory state and the saved project are distinct; verify `persisted`/`persistedLatest` and read the resulting state. For reference clips, use `composition_export_video` and check `job_get` until the file and project association are confirmed. If the timeline has music, the export should carry the same time segment of that music; inspect the returned audio path before a Magnific composition.

Local image/video/music generation and ComfyUI can be requested through the app only if the installed server lists their tools. Generation submission is not completion: inspect the task, inspect its saved project target, and do not duplicate a job after a lost response. Magnific composition preview and execution prepare/upload a board; they do not press Generate. Confirm actual provider output separately before recording it as a result. For music-video composition, keep the exact timeline segment in the reference MP4 and use its matching audio file as a separate audio reference with music enabled; mention both references in the prompt with their actual `@` names. Do not substitute the full song for a 15-second segment.

## Keep the project complete

Every final or candidate image/video created outside the app during this chat must be imported with `media_register` into its character, background, or cut. Supply a stable `operationId`, the local source path, the prompt text, and the current project revision. Videos belong to cuts. If an output has no suitable target, create or identify one first. Save text-only prompts with `project_update`; save generation prompts with the imported asset as well. After import, read the project again and verify file path, prompt, and target. Select the approved representative with `asset_set_primary` and verify there is exactly one primary in that target's image or video shelf. Do not describe an external file as registered until that read-back succeeds.

Maintain separate project context per chat. A later chat resumes from the app's saved state and change history, rather than relying on the earlier chat transcript. When reporting progress, distinguish prepared prompts, submitted jobs, verified outputs, and persisted assets.

The source-level command guide is `docs/APP_CONTROL.md` in the AIMovieStorage repository. The connected server's live schema takes precedence over that document.
