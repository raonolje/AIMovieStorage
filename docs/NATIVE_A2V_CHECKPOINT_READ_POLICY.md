# Native A2V checkpoint read policy

Native A2V disk offload requires an explicit `options.ltx_a2v_checkpoint_read_backend` of `"mmap"` or `"pread"`. Set `options.ltx_a2v` to `true` and `options.ltx_a2v_offload` to `"disk"` with the selected backend. Omitting the backend, passing an invalid value, or supplying this disk-only option with CPU offload fails before a job is queued. The application does not automatically choose or switch the disk backend. Existing explicit choices and saved settings are preserved; legacy CPU offload retains its prior behavior.

The application carries the choice through tool validation, the Rust request, the isolated worker and the bundled SDK. Payload policy is fixed for that worker's lifetime. Metadata reads use the supported safetensors `pread` API, which still creates a transient constructor mapping in safetensors 0.8.0. Selecting `pread` does not guarantee a mapping-free process.

Worker records include requested/resolved policy, read-memory reserve and Windows lifetime peak private commit. Admission reserves are conservative arithmetic; they are not measurements of full GPU peak usage. GPU execution also requires separate authorization.

## Validation and current limits

The corresponding installed release passed type checking, frontend tests (953), native CPU Python tests (38), Rust release tests (158 passed, 4 ignored), frontend/desktop builds, bundled SDK provenance checks and installed CPU request contracts. The installed worker was exercised with both policies using a small CPU tensor and hardware/pipeline stubs. These checks establish request handling and CPU contracts, not GPU speed, full-resolution peak memory, lip sync or visual quality.

The prior 384 comparison produced the same 44 decoded RGB frames and source PCM with `pread`, but took 2,561.878 seconds versus 691.851 seconds for the earlier `mmap` run (3.70 times as long). This is a historical comparison, not a speed improvement claim for the new explicit-policy release.

No new GPU job was run for this release. At its installed 576-by-384, 49-frame assessment, available commit was 92.29 GiB. The arithmetic reserves were 166.28 GiB for `mmap` and 127.15 GiB for `pread`, so both requests failed admission and were not executed. These reserves include constructor allowance, scaled live-buffer reserve and margin; they must not be described as measured usage or as a successful 576 optimization.

A future authorized 576 evaluation must pass resource admission and separately measure whole-process lifetime peak commit, concurrent host headroom and live-buffer phases across import, load, both inference stages, mux and normal exit. No subtraction of unrelated sampled maxima establishes that peak.

Quality remains **HOLD**. The prior comparison inspection covered nine selected contact-sheet frames; it did not establish actual listening, continuous playback or detailed phoneme/lip synchronization. Historical engine QA flags do not certify this release's unperformed GPU evaluation.

The bundled SDK contains source files and its original license files. Its manifest verifies the exact 248 Python source hashes. Model weights, generated media, private settings, credentials, logs and build artifacts are not part of this source update.
