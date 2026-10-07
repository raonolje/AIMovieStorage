// Exact locally reviewed draft variants; source/schema admission remains independently required.
export const V2_REVIEWED_VARIANTS = [
  {
    "id": "h3-ref2va-1-identity",
    "workflowSha256": "cd8df6e990f2630b8ca52f9ab4ac87903a9301d33dffffa76056b7c698545a84",
    "v1SelectionSha256": "c383efad7cca614a581743665d40730f25bbcc16dc5bd98afcbe0d04ebf3be3a",
    "selectionMaterialSha256": "5d621417ef0fc3ccee23153a00f19f3411a830141415ad5e13ad6a5174c17a4b",
    "modelRuleId": "minimaxh3",
    "extensions": [
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_images",
        "referenceGroupId": "identity",
        "component": "image",
        "count": 1
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "ref2va",
      "fps": 24,
      "canvas": {
        "width": 1344,
        "height": 768,
        "multiple": 32
      },
      "frames": {
        "min": 124,
        "max": 362,
        "gridBase": 5,
        "gridStep": 17
      },
      "fixedIdentityCount": 1,
      "referenceVideo": null,
      "referenceAudio": null,
      "pictureTags": [
        "<Picture 1>"
      ],
      "fixedAutogrowExpansion": true
    }
  },
  {
    "id": "h3-ref2va-2-identity",
    "workflowSha256": "d06a88eb4c0a6c7ce8a753fde332c33b0ebc5f4cdb25d024ba006dc922faa98d",
    "v1SelectionSha256": "5e31948ede60da6205bc192c83239070b19fb1f6025e7e4c1b89d859681bd58d",
    "selectionMaterialSha256": "111bf7aabc3cf9cdfc2c82d5e8eb72e0117affe2c73de3152db06dc83b9b7a16",
    "modelRuleId": "minimaxh3",
    "extensions": [
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_images",
        "referenceGroupId": "identity",
        "component": "image",
        "count": 2
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "ref2va",
      "fps": 24,
      "canvas": {
        "width": 1344,
        "height": 768,
        "multiple": 32
      },
      "frames": {
        "min": 124,
        "max": 362,
        "gridBase": 5,
        "gridStep": 17
      },
      "fixedIdentityCount": 2,
      "referenceVideo": null,
      "referenceAudio": null,
      "pictureTags": [
        "<Picture 1>",
        "<Picture 2>"
      ],
      "fixedAutogrowExpansion": true
    }
  },
  {
    "id": "h3-ref2va-4-identity",
    "workflowSha256": "29d0b5763bdf7e70cadb949dc826b7fffaae9d05f90f56a5d4b62fe51bf189ae",
    "v1SelectionSha256": "eb9ee4a17b9795a1a700534f7ca484621a4fa8484bce6985582d416bdd68f81b",
    "selectionMaterialSha256": "f1e756a900250a6efbe4179c44d1a5a215f7f9a8f20bd9bc9d2f14844563d71e",
    "modelRuleId": "minimaxh3",
    "extensions": [
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_images",
        "referenceGroupId": "identity",
        "component": "image",
        "count": 4
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "ref2va",
      "fps": 24,
      "canvas": {
        "width": 1344,
        "height": 768,
        "multiple": 32
      },
      "frames": {
        "min": 124,
        "max": 362,
        "gridBase": 5,
        "gridStep": 17
      },
      "fixedIdentityCount": 4,
      "referenceVideo": null,
      "referenceAudio": null,
      "pictureTags": [
        "<Picture 1>",
        "<Picture 2>",
        "<Picture 3>",
        "<Picture 4>"
      ],
      "fixedAutogrowExpansion": true
    }
  },
  {
    "id": "h3-ref2va-2-identity-video",
    "workflowSha256": "8dc372a6e7374276ab9ca47520e98bcf16417cd5f28502114d412da06d4b4570",
    "v1SelectionSha256": "9376ac3e600183551eb75d0db25bc8b896ed67f63a7c779cb5d48fc35a4683b2",
    "selectionMaterialSha256": "c38bbd56930e0e2c3a7c15b288b1b96f538c1b2eadbc3e1f862d93ecef0a2015",
    "modelRuleId": "minimaxh3",
    "extensions": [
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_images",
        "referenceGroupId": "identity",
        "component": "image",
        "count": 2
      },
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_videos",
        "referenceGroupId": "referenceVideo",
        "component": "video-frames",
        "count": 1
      },
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_video_audios",
        "referenceGroupId": "referenceVideo",
        "component": "video-audio",
        "count": 1
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "ref2va",
      "fps": 24,
      "canvas": {
        "width": 1344,
        "height": 768,
        "multiple": 32
      },
      "frames": {
        "min": 124,
        "max": 362,
        "gridBase": 5,
        "gridStep": 17
      },
      "fixedIdentityCount": 2,
      "referenceVideo": {
        "fps": 24,
        "minFrames": 56,
        "maxFrames": 124,
        "gridBase": 5,
        "gridStep": 17,
        "requiresAudioTrack": true,
        "rejectTruncation": true
      },
      "referenceAudio": null,
      "pictureTags": [
        "<Picture 1>",
        "<Picture 2>"
      ],
      "fixedAutogrowExpansion": true
    }
  },
  {
    "id": "h3-ref2va-1-identity-audio",
    "workflowSha256": "70b14915ee671bea1b760ec232cd1ee21ab22f497c772f70927cdde7eb104fc9",
    "v1SelectionSha256": "6a0c5488123fa8041e2b2c0234c4f257c9981e771ac6677ab94f48e3682b3e4c",
    "selectionMaterialSha256": "57e9b07c0a451a7c2603d6797b459f73d1700665536a4ac9d67c29b22b47ac60",
    "modelRuleId": "minimaxh3",
    "extensions": [
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_images",
        "referenceGroupId": "identity",
        "component": "image",
        "count": 1
      },
      {
        "kind": "autogrow",
        "nodeId": "6",
        "inputGroup": "ref_audios",
        "referenceGroupId": "referenceAudio",
        "component": "audio-reference",
        "count": 1
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "ref2va",
      "fps": 24,
      "canvas": {
        "width": 1344,
        "height": 768,
        "multiple": 32
      },
      "frames": {
        "min": 124,
        "max": 362,
        "gridBase": 5,
        "gridStep": 17
      },
      "fixedIdentityCount": 1,
      "referenceVideo": null,
      "referenceAudio": "standalone-reference-not-driving-audio",
      "pictureTags": [
        "<Picture 1>"
      ],
      "fixedAutogrowExpansion": true
    }
  },
  {
    "id": "ltx25-distilled-t2va",
    "workflowSha256": "c2616a9d694d32feaa2b3d5743e79d0f4e032ca5c0ca761178a5a4f8768f61fe",
    "v1SelectionSha256": "638791106b99104bbeb00ac1716f8b8b1399b4caa2c322a2f363231769e9ea89",
    "selectionMaterialSha256": "5d2856501fdeee588ca2f4de96dec6ded1ef99f5482208dbe98ddddd83d18df4",
    "modelRuleId": "ltx2.5",
    "extensions": [
      {
        "kind": "numeric-union",
        "nodeId": "8",
        "input": "frame_rate",
        "members": [
          "FLOAT",
          "INT"
        ]
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "distilled-int8-convrot",
      "fps": 24,
      "frames": {
        "min": 9,
        "max": 249,
        "gridBase": 1,
        "gridStep": 8
      },
      "canvas": {
        "multiple": 32
      },
      "sameValues": [
        [
          "frames",
          "audioFrames"
        ],
        [
          "conditioningFps",
          "audioFps",
          "outputFps"
        ]
      ],
      "identityReference": false
    }
  },
  {
    "id": "ltx25-distilled-first-frame",
    "workflowSha256": "45e593b5fe0b718a740547bc9fab8198f66b2b3c12de75a9af53265ed3116448",
    "v1SelectionSha256": "84d2a045b69093bbe43c226347c15f0aa2be3b75b363a2d83a0ed87d261bcc3c",
    "selectionMaterialSha256": "69fe171f56f467341541867774f18001cf528f3b5525a0ec68d32176f34a11a9",
    "modelRuleId": "ltx2.5",
    "extensions": [
      {
        "kind": "numeric-union",
        "nodeId": "8",
        "input": "frame_rate",
        "members": [
          "FLOAT",
          "INT"
        ]
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "distilled-int8-convrot",
      "fps": 24,
      "frames": {
        "min": 9,
        "max": 249,
        "gridBase": 1,
        "gridStep": 8
      },
      "canvas": {
        "multiple": 32
      },
      "sameValues": [
        [
          "frames",
          "audioFrames"
        ],
        [
          "conditioningFps",
          "audioFps",
          "outputFps"
        ]
      ],
      "identityReference": false
    }
  },
  {
    "id": "ltx25-distilled-first-last-frame",
    "workflowSha256": "d659b63ea409916a3f26726e07605a670468f7d27e82fb7aaad81afb29f43a7d",
    "v1SelectionSha256": "9b08294d0f1a0df7f9f6d74df93da65978a80a8ff55b026ae487023271284456",
    "selectionMaterialSha256": "a3d861e1d66a873a432dbea606c98d98c897f428af48c2224fc2c16d8da68f52",
    "modelRuleId": "ltx2.5",
    "extensions": [
      {
        "kind": "numeric-union",
        "nodeId": "8",
        "input": "frame_rate",
        "members": [
          "FLOAT",
          "INT"
        ]
      }
    ],
    "inputContract": {
      "projectAssetsOnly": true,
      "decodeAndFullHashRequired": true,
      "noImplicitReferenceReplication": true,
      "noReferenceCollage": true,
      "noMissingMediaDefaults": true,
      "noTruncation": true,
      "modelVariant": "distilled-int8-convrot",
      "fps": 24,
      "frames": {
        "min": 9,
        "max": 249,
        "gridBase": 1,
        "gridStep": 8
      },
      "canvas": {
        "multiple": 32
      },
      "sameValues": [
        [
          "frames",
          "audioFrames"
        ],
        [
          "conditioningFps",
          "audioFps",
          "outputFps"
        ]
      ],
      "identityReference": false
    }
  }
] as const;
export const V2_SCHEMA_SOURCE_PINS = {
  "MiniMaxH3ReferenceToVideo": {
    "classType": "MiniMaxH3ReferenceToVideo",
    "pythonModule": "comfy_extras.nodes_minimax_h3",
    "reviewId": "offline-preset-source-review-v1-core-0.39.0",
    "sourceSha256": "108ceff11e5a5c9a34a57bbc380447cf9941beb673a1bd421abc818de54ccd5c",
    "schemaSha256": "a6fda71ef4f1631f3b55f86df10ea03a36f2ea64b2517ea28fdbc052ea4a6124",
    "comfyVersion": "0.39.0"
  },
  "LTXVEmptyLatentAudio": {
    "classType": "LTXVEmptyLatentAudio",
    "pythonModule": "comfy_extras.nodes_lt_audio",
    "reviewId": "offline-preset-source-review-v1-core-0.39.0",
    "sourceSha256": "19e958412230602ae5499f6fc4f9a50b18a42ddefa5fbcf565e4e39a5b9795f6",
    "schemaSha256": "32ee3f17dc956d9bb577907cc10d4d1e93c5f5f2848f440e94af1c295fb6b9d0",
    "comfyVersion": "0.39.0"
  }
} as const;
