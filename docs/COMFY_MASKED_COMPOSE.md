# Local masked image composite

`comfy_masked_compose` is an official controller tool for joining an existing replacement image to a base image. It submits the bundled, fixed `masked-composite-api.json` workflow to the locally configured ComfyUI endpoint. It does not change the user's configured image or video workflow and does not call a model or paid provider.

Required inputs: `projectId`, `target`, `expectedRevision`, `operationId`, `baseAssetId`, `replacementAssetId`, and `maskAssetId`. All three asset IDs must identify distinct images in that project. Use equally sized images. White mask pixels select the replacement; black pixels retain the base; gray pixels blend them. The result is attached to the target as a new image asset. Check `job_get` with the returned job ID. Reuse `operationId` when checking or retrying the same request.

This is a composite operation. It does not create missing content inside the mask. Prepare and inspect a suitable replacement image first. Reject a result when geometry or lighting at the mask edge does not match, even if pixels outside the mask are preserved.

The implementation reuses the existing Comfy task journal, project revision check, same-project asset resolution, output collection, and result attachment. The dedicated graph contains only `LoadImage`, `LoadImageMask`, `ImageCompositeMasked`, and `SaveImage` nodes. It is packaged as an app resource.

Validation evidence is in `masked-composite-proof.json`, `airport-masked-proof.json`, and `official-mask-result-proof.json` in the task workspace. The official test ran in a separate `MASK QA airport 2026-10-05` project; it did not change `국호 Final`.

The official airport QA output preserved every pixel outside the mask (361,728 pixels). The full-white region matched the replacement within one channel level from PNG conversion. Visual review still found a window-column seam, so the result was not attached to `국호 Final`. A K05 TIDE/PEARL feet sample also preserved every outside pixel (561,998 pixels), but enlarged review showed floating shoes; it was not registered as production art. This workflow solves area preservation, while final image acceptance still depends on a suitable replacement and mask edge.
