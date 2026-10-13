---
name: release
description: Contributor guidance for release.
---

# Release

Read CONTRIBUTING, workflows, package metadata, active changesets and changelog. Verify notes cover incompatible calls and data.

Run check, smoke, production audit and package inspection. Version on a branch; review metadata and changelog through a PR. Publish only after authorization and CI plus smoke pass on the final commit. Verify package provenance, tag target and notes; tags must match npm gitHead and must never move after publication.

Publishing, tagging, pushing and merging require explicit authorization. Passing CI does not prove publication.
