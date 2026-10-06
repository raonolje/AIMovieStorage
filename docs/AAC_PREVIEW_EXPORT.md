# Local AAC compatibility preview

`aac_preview_status` reads the existing CPU media-edit environment. `media_preview_export` queues a CPU task from a registered same-project cut video using its asset ID, cut ID, SHA256, latest project revision and stable operationId. The master must contain one zero-based H264 video track and one mono/stereo ALAC track with equal duration, at most 300 seconds and the existing CPU frame budget. No software/model download or GPU inference is used.

The worker copies video packets and compresses audio to AAC192k. It verifies every copied video packet's payload/PTS/DTS/duration, every decoded RGB frame/PTS, exact audio/video track duration, rate/channels, full FFmpeg decode and the unchanged master SHA. It reports encoder priming and decoded tail padding separately: MP4 edit-list/track duration delimit the playback timeline; raw AAC decoding may return final padded samples. AAC is lossy and is not a replacement for the ALAC master.

Read `job_get` until done. Register the output through `media_register` using the completed job's `previewJobId`, latest revision, a separate operationId and `makePrimary:false`. The app verifies source and derivative hashes before and after import, and stores `previewMetadata` containing the master asset ID/SHA, job ID, lossyAudio:true and worker verification. Preview registration cannot change prompts or make the derivative primary. Same operationId/input reuses the job; changed input conflicts.

Cancellation waits for CPU completion without terminating processes. Export and integrity verification do not establish actual browser playback, listening, phoneme synchronization or content quality. Existing master, voices, prompts and primary selection remain intact.
