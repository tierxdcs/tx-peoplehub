# Design Engineering Phase 1

## Delivered

- Sole Design Head capability assigned or revoked by Super Admin.
- Design access for active DESIGN, ENGINEERING and RND vertical users; Super Admin has operational access but no implicit release authority.
- Design requests for sales orders, project kickoffs, customer changes, internal development, NCR/CAPA and value engineering.
- Design projects with lead designer, target date and requirements-to-production lifecycle.
- Drawing/document register covering GA, manufacturing, assembly, electrical, schematics, calculations, datasheets, specifications, 3D models and work instructions.
- Reuse of the existing Vault for file storage, previews, permissions, uploads and file-version history.
- Every formal engineering revision pins one immutable `VaultFileVersion`; it never follows the Vault file's moving current-version pointer.
- Registering a controlled design file enables Vault versioning and sets unlimited retention on its folder.
- Draft, pending approval, released, rejected and obsolete revision lifecycle.
- Design Head-only release and rejection, with maker-checker protection.
- Design Head signature snapshot on release.
- Releasing a revision atomically obsoletes the previously released revision.
- Production release requires every registered design document to have a released revision.
- UI routes: `/design`, `/design/requests`, `/design/projects` and `/design/documents`.

## Version versus revision

- Vault version: every uploaded set of file bytes, including working changes.
- Engineering revision: the formally reviewed design issue, such as Rev A or Rev B.
- A revision records the exact Vault version that was approved.
- Restoring or uploading a Vault version does not silently change a released engineering revision.

## Next phase

Phase 2 should add structured design inputs/requirements, milestone deliverables, checking before Design Head approval, and customer-approval evidence. Engineering Change Management and cross-module impact assessment should follow after the document-control foundation.
