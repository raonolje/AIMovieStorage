---
name: aimoviestorage-control
description: Control AIMovieStorage from Codex to create or continue film and music-video projects, including Korean requests such as "사용자올제 국호 프로젝트 만들어줘"; register prompts, images, and videos in the app.
---

# AIMovieStorage project work

Use this skill when the user wants to create or continue an AIMovieStorage drama, music video, scene, or shot from a Codex chat. The short Korean request "사용자올제 <이름> 프로젝트 만들어줘" means to work in the AIMovieStorage project named <이름>; "이어줘" means to continue it. First inspect the app and continue an existing matching project instead of creating a duplicate. Ask which project only if the app lists several plausible matches and the choice changes the work.

## Connect and inspect

The desktop app must be running with **Settings → 대화로 앱 조종하기 → 앱 조종 켜기**. Connect Codex to the app's local `aimoviestorage` MCP server using the command shown in that Settings screen. The installed skill does not configure Codex MCP or start the app for the user. Check the connected server's `tools/list` and `app_status`; available commands depend on the installed edition and version. If it is unavailable, say what connection step is missing, and continue any useful offline preparation.

Start each work session with `projects_list`, then `project_get` for the chosen project. Read current IDs, values, and revision before editing. After the user edits in the app, read `project_changes` or `composition_changes` since the last revision; if history is incomplete, get a fresh full snapshot. Incorporate those edits instead of replaying stale commands. Pass the current `expectedRevision` to writes. A revision conflict means read again and re-plan, not blind retry.

## Build and verify

Use `project_update` for story, characters, backgrounds, scenes, cuts and text prompts. For the shot planner, open the appropriate cut, apply supported `composition_apply` commands, capture when needed, and commit the composition. The composition's in-memory state and the saved project are distinct; verify `persisted`/`persistedLatest` and read the resulting state. For reference clips, use `composition_export_video` and check `job_get` until the file and project association are confirmed. If the timeline has music, the export should carry the same time segment of that music; inspect the returned audio path before a Magnific composition.

When creating a character through `character.add`, inspect the app's selected character reference blueprint and send its panel IDs in `fields.blueprint` if the shot needs a different set. Write both `promptKo` and `promptEn` and both negative-prompt languages. The controller inserts the selected sheet-panel instructions into the saved prompts, including the app's default panels when no blueprint is specified. On `character.update`, preserve manually edited identity details and verify that changing `blueprint` replaces the old panel instructions. After saving, read back the character's blueprint and both prompts, generate or register the image, then mark the approved image primary. Selected chips alone are not a generated reference sheet.

For `media_generate` targeting a character, the app adds the current blueprint panels to the worker prompt and records the effective prompt on the result image. Inspect the generated file before choosing it as primary. The current local image workers do not use an existing character image as an editing reference, so do not claim that a locally regenerated sheet preserves an approved face merely because an image ID was supplied. Use a verified reference-editing workflow and `media_register` when exact identity must be retained.

When adding a cut, set `characterIds` to the IDs of people actually visible in that shot; use `[]` for an object or empty-space shot. A name in dialogue, the scene cast, or a neighboring clip does not by itself make that person visible. This field is required in current `cut.add` requests. If an image exists for a selected character, verify that both the saved image and video prompts contain its actual `@` reference after the update. Repair older cuts using the cut's explicit visible-cast evidence and current asset paths; do not attach every scene character to every cut.

Write Korean and English together for each cut image prompt (`promptKo`/`promptEn`), negative prompt (`negativeKo`/`negativeEn`), and video prompt (`videoPromptKo`/`videoPromptEn`). Do not send only the English field because the Korean editor then stays empty. If a cut already has English text but lacks Korean, update the Korean side while preserving the existing English text and any `@` references. The controller rejects a cut prompt edit that would leave just one language populated; prepare both texts before sending a new cut.

For scene storyboards, provide Korean `storyboardPromptKo` and English `storyboardPromptEn` as separate prose. The app rejects a Korean field whose body is mostly English, including cut and character prompts. Do not copy an English scene summary into the Korean field just to make it nonempty; translate the action, dialogue guidance and camera instructions into natural Korean, then read back both fields.

Local image/video/music generation and ComfyUI can be requested through the app only if the installed server lists their tools. Generation submission is not completion: inspect the task, inspect its saved project target, and do not duplicate a job after a lost response. Magnific composition preview and execution prepare/upload a board; they do not press Generate. Confirm actual provider output separately before recording it as a result. For music-video composition, keep the exact timeline segment in the reference MP4 and use its matching audio file as a separate audio reference with music enabled; mention both references in the prompt with their actual `@` names. Do not substitute the full song for a 15-second segment.

## Keep the project complete

Every final or candidate image/video created outside the app during this chat must be imported with `media_register` into its character, background, or cut. Supply a stable `operationId`, the local source path, the prompt text, and the current project revision. Videos belong to cuts. If an output has no suitable target, create or identify one first. Save text-only prompts with `project_update`; save generation prompts with the imported asset as well. After import, read the project again and verify file path, prompt, and target. Select the approved representative with `asset_set_primary` and verify there is exactly one primary in that target's image or video shelf. Do not describe an external file as registered until that read-back succeeds.

Maintain separate project context per chat. A later chat resumes from the app's saved state and change history, rather than relying on the earlier chat transcript. When reporting progress, distinguish prepared prompts, submitted jobs, verified outputs, and persisted assets.

The source-level command guide is `docs/APP_CONTROL.md` in the AIMovieStorage repository. The connected server's live schema takes precedence over that document.
